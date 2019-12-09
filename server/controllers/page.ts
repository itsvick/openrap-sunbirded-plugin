import { logger } from "@project-sunbird/ext-framework-server/logger";
import { Manifest } from "@project-sunbird/ext-framework-server/models";
import * as glob from "glob";
import * as _ from "lodash";
import { containerAPI } from "OpenRAP/dist/api";
import * as path from "path";
import { Config, Inject } from "typescript-ioc";
import * as uuid from "uuid";
import DatabaseSDK from "../sdk/database/index";
import config from "./../config";
import Response from "./../utils/response";
import Content from "./content/content";

export class Page {
  @Inject
  private databaseSdk: DatabaseSDK;

  private fileSDK;

  private content: Content;

  constructor(manifest: Manifest) {
    this.databaseSdk.initialize(manifest.id);
    this.content = new Content(manifest);
    this.fileSDK = containerAPI.getFileSDKInstance(manifest.id);
  }

  public async insert() {
    const pagesFiles = this.fileSDK.getAbsPath(
      path.join("data", "pages", "**", "*.json"),
    );
    const files = glob.sync(pagesFiles, {});

    for (const file of files) {
      const page = await this.fileSDK.readJSON(file);
      const doc = _.get(page, "result.response");
      const id = doc.id;
      // TODO: handle multiple inserts of same page
      await this.databaseSdk.upsert("page", id, doc).catch((err) => {
        logger.error(
          `Received error while upserting the ${id} to channel database and err.message: ${err.message}`,
        );
      });
    }
  }

  public get(req: any, res: any) {
    logger.debug(`ReqId = "${req.headers["X-msgid"]}": Getting page data`);
    const reqBody = req.body;
    const pageReqObject = {
      selector: {
        name: _.get(reqBody, "request.name"),
      },
    };

    const pageReqFilter = _.get(reqBody, "request.filters");
    const mode = _.get(reqBody, "request.mode");
    logger.debug(
      `ReqId = "${req.headers["X-msgid"]}": Get Content search fields from config file`,
    );
    const contentSearchFields = config.get("CONTENT_SEARCH_FIELDS").split(",");
    logger.info(
      `ReqId = "${
        req.headers["X-msgid"]
      }": Content search fields are ${contentSearchFields.toString()}`,
    );
    let filters = _.pick(pageReqFilter, contentSearchFields);
    filters = _.mapValues(filters, (v) => {
      return _.isString(v) ? [v] : v;
    });

    logger.info(`Getting the data from page database`);
    this.databaseSdk
      .find("page", pageReqObject)
      .then((data) => {
        data = _.map(data.docs, (doc) => _.omit(doc, ["_id", "_rev"]));
        if (data.length <= 0) {
          logger.error(
            `ReqId = "${req.headers["X-msgid"]}": Received empty data while searching with pageReqObject: ${pageReqObject} in page database`,
          );
          res.status(404);
          return res.send(Response.error("api.page.assemble", 404));
        }
        logger.info(
          `ReqId = "${req.headers["X-msgid"]}": Received data from page database`,
        );
        const page = data[0];

        const sectionPromises = [];
        logger.info(
          `ReqId = "${req.headers["X-msgid"]}": For each section getting SearchQuery`,
        );
        page.sections.forEach((section) => {
          const searchQuery = JSON.parse(section.searchQuery);
          const sortData = _.get(searchQuery, "request.sort_by");
          let sectionFilters = _.get(searchQuery, "request.filters");
          sectionFilters = _.pick(sectionFilters, contentSearchFields);
          sectionFilters = _.mapValues(sectionFilters, (v) => {
            return _.isString(v) ? [v] : v;
          });
          let dbFilter = {};
          //  If mode is soft we are not adding the filters from the request object
          //  else we will concat and uniq the filters and if is not empty then
          logger.info(
            `ReqId = "${req.headers["X-msgid"]}": Checking if the mode is soft or not`,
          );
          if (mode === "soft") {
            logger.info(`ReqId = "${req.headers["X-msgid"]}": Mode is soft`);
            dbFilter = sectionFilters;
          } else {
            logger.info(
              `ReqId = "${req.headers["X-msgid"]}": Mode is not soft`,
            );
            _.forEach(contentSearchFields, (v) => {
              sectionFilters[v] = sectionFilters[v] || [];
              filters[v] = filters[v] || [];
              const uniqFilter = _.uniq(_.concat(sectionFilters[v], filters[v]));
              if (!_.isEmpty(uniqFilter)) {
                dbFilter[v] = uniqFilter;
              }
            });
          }
          logger.debug(
            `ReqId = "${req.headers["X-msgid"]}": Get section data based on filters for section: : ${section.id}`,
          );
          sectionPromises.push(
            this.getSection(dbFilter, section, sortData, req.headers["X-msgid"]),
          );
        });
        Promise.all(sectionPromises)
          .then((sections) => {
            _.sortBy(sections, [
              (o) => {
                return o.index;
              },
            ]);
            const result = {
              response: {
                id: _.get(page, "id"),
                name: _.get(page, "name"),
                sections,
              },
            };
            logger.info(
              `ReqId = "${req.headers["X-msgid"]}": Receive Page Data`,
            );
            return res.send(Response.success("api.page.assemble", result, req));
          })
          .catch((err) => {
            logger.error(
              ` ReqId = "${req.headers["X-msgid"]}": Received error while getting all the page sections and err.message:  ${err.message}`,
            );
            return res.send(Response.error("api.page.assemble", 500));
          });
      })
      .catch((err) => {
        logger.error(
          `ReqId = "${req.headers["X-msgid"]}": Received error while getting the data from page database and err.message: ${err.message} ${err}`,
        );
        if (err.status === 404) {
          res.status(404);
          return res.send(Response.error("api.page.assemble", 404));
        } else {
          const status = err.status || 500;
          res.status(status);
          return res.send(Response.error("api.page.assemble", status));
        }
      });
  }

  public getSection(filter, section, sortData, reqId) {
    logger.debug(
      `ReqId = "${reqId}": Getting section data based on filters for section : ${section.id}`,
    );
    return new Promise((resolve, reject) => {
      logger.debug(`ReqId = "${reqId}": Search section Contents in ContentDb`);
      this.content
        .searchInDB(filter, reqId, sortData)
        .then((data) => {
          logger.info(
            `ReqId = "${reqId}": Contents:${data.docs.length} are found in section: ${section.id}`,
          );
          if (data.docs.length) {
            section.count = data.docs.length;
            const contents = _.map(data.docs, (doc) =>
              _.omit(doc, ["_id", "_rev"]),
            );
            section.contents = contents;
            resolve(section);
          } else {
            section.count = 0;
            section.contents = null;
            resolve(section);
          }
        })
        .catch((err) => {
          section.count = 0;
          section.contents = null;
          resolve(section);
          logger.error(
            `ReqId = "${reqId}": Received error while getting page section and err.message: ${err.message}`,
          );
        });
    });
  }
}
