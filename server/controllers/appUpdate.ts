import { logger } from "@project-sunbird/ext-framework-server/logger";
import { HTTPService } from "@project-sunbird/ext-framework-server/services";
import * as _ from "lodash";
import * as os from "os";
import Response from "../utils/response";

const systemInfo = {
    x32: "32bit",
    ia32: "32bit",
    x64: "64bit",
    ppc64: "64bit",
    s390: "64bit",
    s390x: "64bit",
    win32: "windows",
    linux: "linux",
};

export default class Appupdate {

    public async getDesktopAppUpate(req, res) {
        const body = {
            request: {
                appVersion: process.env.APP_VERSION,
                os: systemInfo[os.platform()],
                arch: systemInfo[os.arch()],
            },
        };

        const config = {
            headers: {
                "authorization": `Bearer ${process.env.APP_BASE_URL_TOKEN}`,
                "content-type": "application/json",
            },
        };

        try {
            const data = await HTTPService.post(`${process.env.APP_BASE_URL}/api/desktop/v1/update`, body, config)
            .toPromise();
            logger.info(`ReqId = "${req.headers["X-msgid"]}": result: ${_.get(body, "result")} found from desktop app update api`);
            return res.send(Response.success("api.desktop.update", _.get(data, "data.result"), req));
        } catch (err) {
            logger.error(`ReqId = "${req.headers["X-msgid"]}": Received error while processing desktop app update request where err = ${err}`);
            res.status(500);
            return res.send(Response.error("api.desktop.update", 500));
        }
    }
}
