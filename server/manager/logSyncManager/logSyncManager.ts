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

  constructor() {
    this.networkQueue = containerAPI.getNetworkQueueInstance();
    this.settingSDK = containerAPI.getSettingSDKInstance(manifest.id);
  }
  public async start() {
    await this.checkPreviousLogSync();
  }

  private async checkPreviousLogSync() {
    // check in the settingSDK if the LAST_ERROR_LOG_SYNC_ON is not today
    const errorLogDBData = await this.settingSDK.get(LAST_ERROR_LOG_SYNC_ON).catch(() => undefined);
    const lastSyncDate = _.get(errorLogDBData, "lastSyncOn");
    if (!lastSyncDate || !this.isToday(lastSyncDate)) {
      this.launchChildProcess();
    }
  }

  private launchChildProcess() {
    this.workerProcessRef = childProcess.fork(path.join(__dirname, "logSyncHelper"));
    this.handleChildProcessMessage();
    this.getDeviceId();
    this.workerProcessRef.send({
      message: "GET_LOGS",
    });
  }

  private handleChildProcessMessage() {
    this.workerProcessRef.on("message", async (data) => {
      if (data.message === "SYNC_LOGS" && _.get(data, "logs.length")) {
        this.syncLogsToServer(data.logs);
      } else if (data.message === "IMPORT_ERROR") {
        this.handleChildProcessError(data.err);
      } else {
        this.handleChildProcessError({ errCode: "UNHANDLED_WORKER_MESSAGE", errMessage: "unsupported import step" });
      }
    });
  }

  private async syncLogsToServer(logs) {
    const headers = {
      "Content-Type": "application/json",
      "did": this.deviceId,
    };

    const requestBody = {
      pdata: undefined,
      context: undefined,
      logs,
    };

    const request = {
      bearerToken: false,
      pathToApi: `${process.env.APP_BASE_URL}/api/data/v1/client/logs`,
      requestHeaderObj: headers,
      subType: "LOGS",
      requestBody,
    };
    await this.networkQueue.add(request).then((data) => {
      this.updateLastSyncDate(Date.now());
    });
  }

  private async handleKillSignal() {
    return new Promise((resolve, reject) => {
      this.workerProcessRef.on("message", async (data) => {
        if (data.message === "LOG_SYNC_KILL") {
          this.workerProcessRef.kill();
          resolve();
        }
      });
    });
  }

  private handleChildProcessError(error: ErrorObj) {
    logger.error();
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
