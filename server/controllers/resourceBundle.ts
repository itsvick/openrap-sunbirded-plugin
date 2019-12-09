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

export class ResourceBundle {
  // resourceBundleFiles
  @Inject
  private databaseSdk: DatabaseSDK;

  private fileSDK;
  constructor(manifest: Manifest) {
    this.databaseSdk.initialize(manifest.id);
    this.fileSDK = containerAPI.getFileSDKInstance(manifest.id);
  }

  public async insert() {
    const resourceBundleFiles = this.fileSDK.getAbsPath(
      path.join("data", "resourceBundles", "**", "*.json"),
    );
    const files = glob.sync(resourceBundleFiles, {});

    for (const file of files) {
      const bundle = await this.fileSDK.readJSON(file);
      const id = path.basename(file, path.extname(file));
      await this.databaseSdk
        .upsert("resource_bundle", id, bundle)
        .catch((err) => {
          logger.error(
            `while upserting the ${id} to resourcebundles database  ${err}`,
          );
        });
    }
  }

  public get(req, res) {
    logger.debug(
      `ReqId = "${req.headers["X-msgid"]}": Get method called to get resourcebundles `,
    );
    const id = req.params.id || "en";
    logger.info(
      `ReqId = "${req.headers["X-msgid"]}": Getting the data from resource_bundle database with id: ${id}`,
    );
    this.databaseSdk
      .get("resource_bundle", id)
      .then((data) => {
        data = _.omit(data, ["_id", "_rev"]);
        logger.info(
          `ReqId = "${req.headers["X-msgid"]}": Received data with id: ${id} in resource_bundle database`,
        );
        return res.send(Response.success("api.resoucebundles.read", data, req));
      })
      .catch((err) => {
        logger.error(
          `ReqId = "${req.headers["X-msgid"]}": Received error while getting the data from resource_bundle database with id: ${id} and err: ${err}`,
        );
        if (err.status === 404) {
          res.status(404);
          return res.send(Response.error("api.resoucebundles.read", 404));
        } else {
          const status = err.status || 500;
          res.status(status);
          return res.send(Response.error("api.resoucebundles.read", status));
        }
      });
  }
}
