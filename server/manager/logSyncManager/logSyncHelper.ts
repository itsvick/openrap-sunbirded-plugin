import { logger } from "@project-sunbird/logger";
import * as fs from "fs";
import * as path from "path";
import { ErrorObj, getErrorObj, handelError } from "./ILogSync";

const logsStack = [];
const MAX_LOG_LENGTH = 30;
const MAX_FILES = 10;

function readFile(filePath) {
  const file = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (let index = 1; index <= MAX_LOG_LENGTH; index++) {
    if (index > file.length || logsStack.length === MAX_LOG_LENGTH) {
      break;
    }
    const line = file[file.length - index];
    if (line.length) {
      logsStack.push(JSON.parse(line));
    }
  }
}

const formatDate = (date) => {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
};

function getPreviousDate(currentDate) {
  const previousDate = new Date(currentDate);
  previousDate.setDate(previousDate.getDate() - 1);
  return previousDate;
}

function getFilePath(date) {
  const formattedDate = formatDate(date);
  const fileName = `app-${formattedDate}.log`;
  const basePath = path.join(process.env.FILES_PATH, "logs");

  return path.join(basePath, fileName);
}

const getLogs = () => {
  try {

    let currentDay = new Date();
    let filePath = getFilePath(currentDay);
    if (fs.existsSync(filePath)) {
      readFile(filePath);
    }
    let dayIndex = 1;
    while (logsStack.length <= MAX_LOG_LENGTH) {
      if (dayIndex >= MAX_FILES) {
        break;
      }
      currentDay = getPreviousDate(currentDay);
      filePath = getFilePath(currentDay);
      if (fs.existsSync(filePath)) {
        readFile(filePath);
      } else {
        break;
      }
      dayIndex++;
    }

    sendMessage("SYNC_LOGS");
  } catch (error) {
    sendMessage("IMPORT_ERROR", getErrorObj(error, "UNHANDLED_ERROR_LOG_SYNC_ERROR"));
  };
};

const sendMessage = (message: string, err?: ErrorObj) => {
  const messageObj: any = { message, logs: JSON.stringify(logsStack) };
  if (err) {
    messageObj.err = err;
  }
  process.send(messageObj);
};

process.on("message", (data) => {
  if (data.message === "GET_LOGS") {
    getLogs();
  } else if (data.message === "KILL") {
    sendMessage("LOG_SYNC_KILL");
  }
});
