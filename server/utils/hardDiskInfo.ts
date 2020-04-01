import * as  _ from "lodash";
import { containerAPI } from "OpenRAP/dist/api";
import * as os from "os";
import { manifest } from "../manifest";
const systemSDK = containerAPI.getSystemSDKInstance(manifest.id);
const fileSDK = containerAPI.getFileSDKInstance(manifest.id);

export default class HardDiskInfo {
    public static async getAvailableDiskSpace() {
        const { availableHarddisk, fsSize } = await systemSDK.getHardDiskInfo();

        if (os.platform() === "win32") {
            const fileSize: any = fsSize;
            const getAvailableSpace = (drive: any) => drive.size - drive.used;
            const currentContentPath = fileSDK.getAbsPath("") || "C:";
            const selectedDrive = fileSize.find((driveInfo) => currentContentPath.startsWith(driveInfo.fs));
            const availableDriveSpace = getAvailableSpace(selectedDrive);

            return availableDriveSpace - 5e+8; // keeping buffer of 500 mb, this can be configured
        } else {
            return availableHarddisk - 5e+8; // keeping buffer of 500 mb, this can be configured
        }
    }
}
