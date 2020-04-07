import { frameworkAPI } from "@project-sunbird/ext-framework-server/api";
import * as  _ from "lodash";
import { containerAPI } from "OpenRAP/dist/api";
import * as path from "path";

export default class ContentLocation {
  private fileSDK;
  private settingSDK;
  constructor(manifestId) {
    this.fileSDK = containerAPI.getFileSDKInstance(manifestId);
    this.settingSDK = containerAPI.getSettingSDKInstance(manifestId);
  }
  public async set(contentPath: string) {
    try {
      const response: any = await this.settingSDK.get(`content_storage_location`);
      response.location.push(contentPath);
      const contentLocation = { location: response.location };
      const status = await this.settingSDK.put(`content_storage_location`, contentLocation);

      if (status) {
        frameworkAPI.registerStaticRoute(path.join(contentPath, "content"), "/content");
        frameworkAPI.registerStaticRoute(path.join(contentPath, "content"), "/contentPlayer/preview/content");
        frameworkAPI.registerStaticRoute(path.join(contentPath, "content"), "/contentPlayer/preview");
        frameworkAPI.registerStaticRoute(path.join(contentPath, "content"), "/contentPlayer/preview/content/*/content-plugins");
        await this.fileSDK.mkdir("content", contentPath);
      }

      return status;
    } catch (error) {
      throw new error(error);
    }
  }

  public async get() {
    // if (os.platform() === "win32") {
    try {
      const contentDirPath: any = await this.settingSDK.get(`content_storage_location`);

      if (_.get(contentDirPath, "location.length")) {
        return path.join(contentDirPath.location[contentDirPath.location.length - 1], "content");
      }

    } catch (error) {
      return this.fileSDK.getAbsPath("content");
    }
    // } else {
    //   return this.fileSDK.getAbsPath("content");
    // }
  }
}
