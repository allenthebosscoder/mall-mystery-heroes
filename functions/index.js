const express = require("express");
const cors = require("cors");

var corsOptions = {
    origin: "http://localhost:3000"
  };

const app = express();
app.use(cors({ corsOptions }));

const { killPlayer } = require("./callableFunctions/killPlayer")
exports.killPlayer = killPlayer

const { undoKillPlayer } = require("./callableFunctions/undoKillPlayer")
exports.undoKillPlayer = undoKillPlayer

const { joinRoom } = require("./callableFunctions/joinRoom")
exports.joinRoom = joinRoom

const { cleanupEndedRooms } = require("./scheduledFunctions/cleanupEndedRooms")
exports.cleanupEndedRooms = cleanupEndedRooms