import { frameworkAPI } from "@project-sunbird/ext-framework-server/api";
import { Manifest } from "@project-sunbird/ext-framework-server/models";
import { logger } from "@project-sunbird/logger";
import { ClassLogger } from "@project-sunbird/logger/decorator";
import { containerAPI } from "OpenRAP/dist/api";
import * as path from "path";
import Response from "./../utils/response";

/*@ClassLogger({
  logLevel: "debug",
  logTime: true,

})*/
export default class ContentLocation {
  private fileSDK;
  private settingSDK;
  constructor(manifestId) {
    this.fileSDK = containerAPI.getFileSDKInstance(manifestId);
    this.settingSDK = containerAPI.getSettingSDKInstance(manifestId);
  }
  public async changeContentLocation(contentPath: string) {

    try {
      const response: any = await this.settingSDK.get(`content_storage_location`);
      response.location.push(contentPath);
      const contentLocation = { location: response.location };
      const status = await this.settingSDK.put(`content_storage_location`, contentLocation);

      if (status) {
        setTimeout(() => {
          frameworkAPI.registerStaticRoute(path.join(contentPath, "content"), "/content");
        }, 1000);
        await this.fileSDK.mkdir("content", contentPath);
      }

      return status;
    } catch (error) {
      throw new error(error);
    }
  }

  public async getContentAbsPath() {
    // if (os.platform() === "win32") {
    try {
      const contentLocation: any = await this.settingSDK.get(`content_storage_location`);
      if (contentLocation && contentLocation.location && contentLocation.location.length) {
        return path.join(contentLocation.location[contentLocation.location.length - 1], "content");
      }

    } catch (error) {
      return this.fileSDK.getAbsPath("content");
    }
    // } else {
    //   return this.fileSDK.getAbsPath("content");
    // }
  }
}
