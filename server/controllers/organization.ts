import { logger } from "@project-sunbird/ext-framework-server/logger";
import { Manifest } from "@project-sunbird/ext-framework-server/models";
import * as fs from "fs";
import * as glob from "glob";
import * as _ from "lodash";
import { containerAPI } from "OpenRAP/dist/api";
import * as path from "path";
import { Inject } from "typescript-ioc";
import DatabaseSDK from "../sdk/database/index";
import Response from "./../utils/response";

export class Organization {
  @Inject
  private databaseSdk: DatabaseSDK;

  private fileSDK;

  constructor(manifest: Manifest) {
    this.databaseSdk.initialize(manifest.id);
    this.fileSDK = containerAPI.getFileSDKInstance(manifest.id);
  }

  public async insert() {
    const organizationFiles = this.fileSDK.getAbsPath(
      path.join("data", "organizations", "**", "*.json"),
    );
    const files = glob.sync(organizationFiles, {});

    for (const file of files) {
      const organization = await this.fileSDK.readJSON(file);
      const id = path.basename(file, path.extname(file));
      const doc = _.get(organization, "result.response.content[0]");
      await this.databaseSdk.upsert("organization", id, doc).catch((err) => {
        logger.error(
          `Received error while upserting the ${id} to channel database and err.message: ${err.message}`,
        );
      });
    }
  }

  public search(req, res) {
    logger.debug(
      `ReqId = "${req.headers["X-msgid"]}": Organisation search method is called`,
    );
    const requestBody = req.body;

    const searchObj = {
      selector: _.get(requestBody, "request.filters"),
    };
    logger.debug(
      `ReqId = "${req.headers["X-msgid"]}": Finding the data from organization database`,
    );
    this.databaseSdk
      .find("organization", searchObj)
      .then((data) => {
        data = _.map(data.docs, (doc) => _.omit(doc, ["_id", "_rev"]));
        const resObj = {
          response: {
            content: data,
            count: data.length,
          },
        };
        logger.info(
          `ReqId = "${req.headers["X-msgid"]}": Received data from organization database`,
        );
        return res.send(Response.success("api.org.search", resObj, req));
      })
      .catch((err) => {
        logger.error(
          `ReqId = "${req.headers["X-msgid"]}": Received error while searching in organization database and err.message: ${err.message} ${err}`,
        );
        if (err.status === 404) {
          res.status(404);
          return res.send(Response.error("api.org.search", 404));
        } else {
          const status = err.status || 500;
          res.status(status);
          return res.send(Response.error("api.org.search", status));
        }
      });
  }
}
