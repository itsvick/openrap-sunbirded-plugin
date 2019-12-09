import {
  Manifest,
  BaseServer
} from "@project-sunbird/ext-framework-server/models";
import { frameworkAPI } from "@project-sunbird/ext-framework-server/api";
import * as path from "path";
import { Inject } from "typescript-ioc";
import {ContentImportManager} from "./manager/contentImportManager"
import { Framework } from "./controllers/framework";
import { Faqs } from "./controllers/faqs";
import { Organization } from "./controllers/organization";
import { Page } from "./controllers/page";
import { ResourceBundle } from "./controllers/resourceBundle";
import { Channel } from "./controllers/channel";
import { Form } from "./controllers/form";
import { Location } from './controllers/location';
import DatabaseSDK from "./sdk/database";
import config from "./config";
import { logger } from "@project-sunbird/ext-framework-server/logger";
import { containerAPI } from "OpenRAP/dist/api";
import {
  addContentListener,
  reconciliation
} from "./controllers/content/contentHelper";
import * as _ from "lodash";
import { EventManager } from "@project-sunbird/ext-framework-server/managers/EventManager";

export class Server extends BaseServer {
  private sunbirded_plugin_initialized = false;
  private ecarsFolderPath: string = "ecars";
  private contentFilesPath: string = "content";
  private tempPath: string = "temp";
  private telemetryArchivedFolderPath: string = "telemetry_archived";

  @Inject
  private databaseSdk: DatabaseSDK;

  @Inject
  private contentImportManager: ContentImportManager;

  @Inject
  private fileSDK;

  constructor(manifest: Manifest) {
    super(manifest);

    // Added timeout since db creation is async and it is taking time and insertion is failing
    this.fileSDK = containerAPI.getFileSDKInstance(manifest.id);

    this.initialize(manifest)
      .then(() => {
        this.sunbirded_plugin_initialized = true;
        EventManager.emit(`${manifest.id}:initialized`, {});
      })
      .catch(err => {
        logger.error(
          "Error while initializing open rap sunbird ed plugin",
          err
        );
        this.sunbirded_plugin_initialized = true;
        EventManager.emit(`${manifest.id}:initialized`, {});
      });
  }
  async initialize(manifest: Manifest) {
    //registerAcrossAllSDKS()
    this.databaseSdk.initialize(manifest.id);

    frameworkAPI.registerStaticRoute(
      this.fileSDK.getAbsPath(this.contentFilesPath),
      "/contentPlayer/preview/content"
    );
    frameworkAPI.registerStaticRoute(
      this.fileSDK.getAbsPath(this.contentFilesPath),
      "/contentPlayer/preview"
    );
    frameworkAPI.registerStaticRoute(
      this.fileSDK.getAbsPath(this.contentFilesPath),
      "/contentPlayer/preview/content/*/content-plugins"
    );
    frameworkAPI.registerStaticRoute(
      path.join(__dirname, "..", "..", "public", "contentPlayer", "preview"),
      "/contentPlayer/preview"
    );
    frameworkAPI.registerStaticRoute(
      this.fileSDK.getAbsPath(this.contentFilesPath),
      "/content"
    );
    frameworkAPI.registerStaticRoute(
      this.fileSDK.getAbsPath(this.ecarsFolderPath),
      "/ecars"
    );
    frameworkAPI.registerStaticRoute(
      this.fileSDK.getAbsPath(this.tempPath),
      "/temp"
    );
    frameworkAPI.registerStaticRoute(
      path.join(__dirname, "..", "..", "public", "portal")
    );
    frameworkAPI.registerStaticRoute(
      path.join(__dirname, "..", "..", "public", "sunbird-plugins"),
      "/sunbird-plugins"
    );
    frameworkAPI.setStaticViewEngine("ejs");

    // insert meta data for app
    await this.insertConfig(manifest);

    const pluginConfig = {
      pluginVer: manifest.version,
      apiToken: process.env.APP_BASE_URL_TOKEN,
      apiBaseURL: process.env.APP_BASE_URL,
      apiTokenRefreshFn: "refreshToken"
    };
    await containerAPI.register(manifest.id, pluginConfig);

    await this.fileSDK.mkdir(this.contentFilesPath);
    await this.fileSDK.mkdir(this.ecarsFolderPath);
    await this.fileSDK.mkdir(this.telemetryArchivedFolderPath);

    // listener to index content when content downloaded
    addContentListener(manifest.id);
    reconciliation(manifest.id);

    this.contentImportManager.initialize(
      manifest.id,
      this.fileSDK.getAbsPath(this.contentFilesPath),
      this.fileSDK.getAbsPath(this.ecarsFolderPath)
    );
    await this.contentImportManager.reconcile();
    // delete contents in temp directory
    await this.fileSDK
      .remove("temp")
      .catch(err =>
        logger.error(`while emptying temp folder on startup ${err}`)
      );
    //- reIndex()
    //- reConfigure()
  }

  private async insertConfig(manifest: Manifest) {
    const framework = new Framework(manifest);
    const faqs = new Faqs(manifest);
    const organization = new Organization(manifest);
    const page = new Page(manifest);
    const resourceBundle = new ResourceBundle(manifest);
    const channel = new Channel(manifest);
    const form = new Form(manifest);
    const location = new Location(manifest);

    await organization.insert();
    await resourceBundle.insert();
    await framework.insert();
    await faqs.insert();
    await channel.insert();
    await form.insert();
    await page.insert();
    await location.insert();
  }
}

process
  .on("unhandledRejection", (reason, p) => {
    logger.error(reason, "Unhandled Rejection at Promise", p);
  })
  .on("uncaughtException", err => {
    logger.error(err, "Uncaught Exception thrown");
    process.exit(1);
  });
