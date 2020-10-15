import { logger } from "@project-sunbird/logger";
import * as childProcess from "child_process";
import * as _ from "lodash";
import { containerAPI } from "OpenRAP/dist/api";
import { NetworkQueue } from "OpenRAP/dist/services/queue";
import * as path from "path";
import { Singleton } from "typescript-ioc";
import { manifest } from "../../manifest";
import { ErrorObj } from "./ILogSync";

const LAST_ERROR_LOG_SYNC_ON = "LAST_ERROR_LOG_SYNC_ON";

@Singleton
export class LogSyncManager {
  private deviceId: string;
  private networkQueue: NetworkQueue;
  private settingSDK;
  private workerProcessRef: childProcess.ChildProcess;
  private isInProgress = false;

  constructor() {
    this.networkQueue = containerAPI.getNetworkQueueInstance();
    this.settingSDK = containerAPI.getSettingSDKInstance(manifest.id);
  }
  public async start() {
    if (!this.isInProgress) {
      await this.checkPreviousLogSync();
    }
  }

  private async checkPreviousLogSync() {
    // check in the settingSDK if the LAST_ERROR_LOG_SYNC_ON is not today
    const errorLogDBData = await this.settingSDK.get(LAST_ERROR_LOG_SYNC_ON).catch(() => undefined);
    const lastSyncDate = _.get(errorLogDBData, "lastSyncOn");
    if (!lastSyncDate || !this.isToday(lastSyncDate)) {
      await this.launchChildProcess();
    }
  }

  private async launchChildProcess() {
    this.isInProgress = true;
    await this.getDeviceId();
    this.workerProcessRef = childProcess.fork(path.join(__dirname, "logSyncHelper"));
    this.handleChildProcessMessage();
    this.workerProcessRef.send({
      message: "GET_LOGS",
    });
  }

  private handleChildProcessMessage() {
    this.workerProcessRef.on("message", async (data) => {
      if (data.message === "SYNC_LOGS" && _.get(data, "logs.length")) {
        this.syncLogsToServer(data.logs);
        this.isInProgress = false;
      } else if (data.message === "ERROR_LOG_SYNC_ERROR") {
        this.handleChildProcessError(data.err);
        this.isInProgress = false;
      } else {
        this.handleChildProcessError({ errCode: "UNHANDLED_WORKER_MESSAGE", errMessage: "unsupported import step" });
        this.isInProgress = false;
      }
    });
  }

  private async syncLogsToServer(logs) {
    const headers = {
      "Content-Type": "application/json",
      "did": this.deviceId,
    };

    const request = {
      bearerToken: true,
      pathToApi: `${process.env.APP_BASE_URL}/api/data/v1/client/logs`,
      requestHeaderObj: headers,
      subType: "LOGS",
      requestBody: this.buildRequestBody(logs),
    };
    this.networkQueue.add(request).then((data) => {
      logger.info("Added in queue");
      this.killChildProcess();
      this.updateLastSyncDate(Date.now());
    }).catch((error) => {
      logger.error("Error while adding to Network queue", error);
    });
  }

  private buildRequestBody(logs = []) {
    return {
      request: {
        context: {
          env: manifest.id,
          did: this.deviceId,
        },
        pdata: {
          id: process.env.APP_ID,
          ver: process.env.APP_VERSION,
          pid: "desktop.app",
        },
        logs,
      },
    };
  }

  private killChildProcess() {
    this.workerProcessRef.kill();
  }

  private handleChildProcessError(error: ErrorObj) {
    logger.error(error.errMessage);
  }

  private async updateLastSyncDate(date: number) {
    await this.settingSDK.put(LAST_ERROR_LOG_SYNC_ON, { lastSyncOn: date });
  }

  private isToday(inputDate) {
    if (inputDate) {
      const today = new Date();
      return today.setHours(0, 0, 0, 0) === inputDate.setHours(0, 0, 0, 0);
    }
    return false;
  }

  private async getDeviceId() {
    this.deviceId = await containerAPI.getSystemSDKInstance(manifest.id).getDeviceId();
  }
}
