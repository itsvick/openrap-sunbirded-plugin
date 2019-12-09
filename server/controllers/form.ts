import { Manifest } from "@project-sunbird/ext-framework-server/models";
import DatabaseSDK from "../sdk/database/index";

import { logger } from "@project-sunbird/ext-framework-server/logger";
import * as glob from "glob";
import Hashids from "hashids";
import * as _ from "lodash";
import { containerAPI } from "OpenRAP/dist/api";
import * as path from "path";
import { Inject } from "typescript-ioc";
import * as uuid from "uuid";
import Response from "./../utils/response";

export class Form {
  @Inject
  private databaseSdk: DatabaseSDK;

  private fileSDK;

  constructor(manifest: Manifest) {
    this.databaseSdk.initialize(manifest.id);
    this.fileSDK = containerAPI.getFileSDKInstance(manifest.id);
  }
  public async insert() {
    const formFiles = this.fileSDK.getAbsPath(
      path.join("data", "forms", "**", "*.json"),
    );
    const files = glob.sync(formFiles, {});

    for (const file of files) {
      const form = await this.fileSDK.readJSON(file);
      const doc = _.get(form, "result.form");

      doc.rootOrgId = doc.rootOrgId || "*";
      doc.component = doc.component || "*";
      doc.framework = doc.framework || "*";
      const idText = `${doc.type}_${doc.subtype}_${doc.action}_${doc.rootOrgId}_${doc.framework}_${doc.component}`;
      const hash = new Hashids(idText, 10);
      const id = hash.encode(1).toLowerCase();
      // TODO: handle multiple inserts of same form
      await this.databaseSdk.upsert("form", id, doc).catch((err) => {
        logger.error(
          `Received error while upserting the ${idText} to form database and err.message: ${err.message}`,
        );
      });
    }
  }

  public search(req, res) {
    logger.debug(
      `ReqId = "${req.headers["X-msgid"]}": Form search method is called`,
    );
    const requestBody = req.body;
    let requestObj = _.get(requestBody, "request");
    requestObj = {
      type: requestObj.type,
      subtype: requestObj.subType,
      action: requestObj.action,
    };
    // TODO: Need tp handle all the cases with rootOrg and framework and component
    // requestObj.rootOrgId = requestObj.rootOrgId || '*';
    // requestObj.component = requestObj.component || '*';
    // requestObj.framework = requestObj.framework || '*';

    const searchObj = {
      selector: requestObj,
    };
    logger.debug(
      `ReqId = "${req.headers["X-msgid"]}": Finding the data from Form database`,
    );
    this.databaseSdk
      .find("form", searchObj)
      .then((data) => {
        data = _.map(data.docs, (doc) => _.omit(doc, ["_id", "_rev"]));
        if (data.length <= 0) {
          logger.error(
            `ReqId = "${req.headers["X-msgid"]}": Received empty data while searching with ${searchObj} in form database`,
          );
          res.status(404);
          return res.send(Response.error("api.form.read", 404));
        }
        const resObj = {
          form: data[0],
        };
        logger.info(
          `ReqId = "${req.headers["X-msgid"]}": Received data  from - form database`,
        );
        return res.send(Response.success("api.form.read", resObj, req));
      })
      .catch((err) => {
        logger.error(
          `ReqId = "${req.headers["X-msgid"]}": Received error while searching in form database and err.message: ${err.message} ${err}`,
        );
        if (err.status === 404) {
          res.status(404);
          return res.send(Response.error("api.form.read", 404));
        } else {
          const status = err.status || 500;
          res.status(status);
          return res.send(Response.error("api.form.read", status));
        }
      });
  }
}
