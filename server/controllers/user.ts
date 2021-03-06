import { logger } from "@project-sunbird/ext-framework-server/logger";
import { Manifest } from "@project-sunbird/ext-framework-server/models";
import * as _ from "lodash";
import { containerAPI } from "OpenRAP/dist/api";
import Response from "../utils/response";

export default class User {
    private userSDK;
    private settingSDK;
    constructor(manifest: Manifest) {
        this.userSDK = containerAPI.getUserSdkInstance();
        this.settingSDK = containerAPI.getSettingSDKInstance(manifest.id);
    }

    public async create(req, res) {
        try {
            if (!_.get(req, "body.request")) {
                res.status(400);
                return res.send(
                    Response.error("api.desktop.user.read", 400, "Request object is required"),
                );
            }
            const createResp = await this.userSDK.create(_.get(req, "body.request"));
            logger.info(`ReqId = "${req.headers["X-msgid"]}": request: ${_.get(req, "body.request")} found from desktop app update api`);
            return res.send(Response.success("api.desktop.user.create", { id: createResp._id }, req));
        } catch (err) {
            logger.error(`ReqId = "${req.headers["X-msgid"]}": Received error while adding user,  where err = ${err}`);
            res.status(err.status || 500);
            return res.send(
                Response.error("api.desktop.user.create", err.status || 500, err.message || ""),
            );
        }
    }

    public async read(req, res) {
        try {
            const userData = await this.userSDK.read();
            const locationData = await this.settingSDK.get("location");
            userData.location = locationData;
            logger.info(`ReqId = "${req.headers["X-msgid"]}": result: ${userData} found from desktop app update api`);
            return res.send(Response.success("api.desktop.user.read", userData, req));
        } catch (err) {
            logger.error(`ReqId = "${req.headers["X-msgid"]}": Received error while getting user,  where err = ${err}`);
            res.status(err.status || 500);
            return res.send(
                Response.error("api.desktop.user.read", err.status || 500, err.message || ""),
            );
        }
    }
}
