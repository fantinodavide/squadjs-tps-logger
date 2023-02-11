import DiscordBasePlugin from './discord-base-plugin.js';
import LogParser from '../../core/log-parser/index.js';

import async from 'async';
import * as http from 'http';

export default class TpsLogger extends DiscordBasePlugin {
    static get description() {
        return "TPS Logger plugin";
    }

    static get defaultEnabled() {
        return true;
    }

    static get optionsSpecification() {
        return {
            ...DiscordBasePlugin.optionsSpecification,
            commandPrefix: {
                required: false,
                description: "Prefix of every in-game command",
                default: "!tps"
            },
            httpServerEnabled: {
                required: true,
                description: "Enables/Disables the http server that hosts the TPS history with events",
                default: false
            },
            httpServerPort: {
                required: false,
                description: "The port used by the http server",
                default: 3030
            },
            tpsHistoryLength: {
                required: false,
                description: "",
                default: 200
            }
        };
    }

    constructor(server, options, connectors) {
        super(server, options, connectors);

        // LogParser.prototype.orProcessLine = LogParser.prototype.processLine;
        this.orProcessLine = this.server.logParser.processLine;

        this.tickRates = []

        this.tickRateUpdated = this.tickRateUpdated.bind(this);
        this.httpServer = this.httpServer.bind(this);
        this.pushEventInTpsHistory = this.pushEventInTpsHistory.bind(this);
        this.bindListeners = this.bindListeners.bind(this);
        this.logLineReceived = this.logLineReceived.bind(this);
        this.getLatestTpsRecord = this.getLatestTpsRecord.bind(this);
        this.pushLogInTpsHistory = this.pushLogInTpsHistory.bind(this);
        this.getAverageTps = this.getAverageTps.bind(this);
        this.clearLogHistoryInTpsRecord = this.clearLogHistoryInTpsRecord.bind(this);
        this.canClearLog = this.canClearLog.bind(this);
        this.upgradeProcessLine = this.upgradeProcessLine.bind(this);
        this.upgradedProcessLine = this.upgradedProcessLine.bind(this);

        this.broadcast = this.server.rcon.broadcast;
        this.warn = this.server.rcon.warn;

        this.upgradeProcessLine();
    }

    async mount() {
        // this.bindListeners();
        console.log(this.server.logParser.processLine)
        this.httpServer();

        this.server.on('TICK_RATE', this.tickRateUpdated)
    }

    async unmount() {
        this.verbose(1, 'TpsLogger unmounted');
    }

    httpServer() {
        if (this.options.httpServerEnabled) {
            let error = false;
            try {
                http.createServer((req, res) => {
                    res.setHeader('Content-Type', 'application/json');
                    res.write(JSON.stringify(this.tickRates, null, 2));
                    res.end();
                }).listen(this.options.httpServerPort);
            } catch (e) {
                error = e;
                this.verbose(1, `Could not start the HTTP server. Error:`, e)
            }

            if (!error) this.verbose(1, `HTTP server started on port ${this.options.httpServerPort}`)
        }
    }

    pushEventInTpsHistory(name, data) {
        const index = this.tickRates.length == 0 ? 0 : this.tickRates.length - 1;
        if (!this.tickRates[ index ]) return;
        this.tickRates[ index ].events.push({ eventName: name, data: data })
    }

    tickRateUpdated(dt) {
        this.verbose(1, 'TPS Update', dt)
        const tps = Math.floor(Math.random() * 2) == 1 ? 25 : dt.tickRate;
        this.tickRates.push({
            tickRate: tps,
            averageTickRate: 0,
            time: dt.time,
            playerCount: this.server.players.length,
            layer: this.server.currentLayer.layerid,
            events: [],
            logs: {
                count: 0,
                history: []
            }
        })

        if (this.tickRates.length > this.options.tpsHistoryLength) this.tickRates.shift();

        const latestTpsRecordIndex = this.getLatestTpsRecord();
        this.tickRates[ latestTpsRecordIndex ].averageTickRate = this.getAverageTps();
        this.clearLogHistoryInTpsRecord(latestTpsRecordIndex - 1)
    }

    async logLineReceived(dt) {
        this.verbose(2, `Received log line`, dt)
        this.pushLogInTpsHistory(dt)
    }

    pushLogInTpsHistory(log) {
        this.verbose(1, `Adding log to tps history`)
        const index = this.getLatestTpsRecord();
        if (!this.tickRates[ index ]) return;
        this.tickRates[ index ].logs.history.push(log);
        this.tickRates[ index ].logs.count++;
    }

    clearLogHistoryInTpsRecord(tpsRecordIndex) {
        this.verbose(1, `Checking permission to clear log history ${tpsRecordIndex}`)
        if (tpsRecordIndex < 0 || tpsRecordIndex >= this.tickRates.length) return;
        if (!this.canClearLog(tpsRecordIndex)) return;
        this.verbose(1, `Clearing log history ${tpsRecordIndex}`)
        this.tickRates[ tpsRecordIndex ].logs.history = [];
    }

    canClearLog(tpsRecordIndex) {
        // this.verbose(1, `Tickrate length:`, this.tickRates.length)
        // this.verbose(1, `Prev tickrate *0.75`, this.tickRates[ tpsRecordIndex - 1 ].tickRate * 0.75)
        // this.verbose(1, `Prev cond`, this.tickRates[ tpsRecordIndex - 1 ].tickRate * 0.75 < this.tickRates[ tpsRecordIndex ].tickRate)
        // this.verbose(1, `Next cond`, this.tickRates[ tpsRecordIndex ].tickRate * 0.75 < this.tickRates[ tpsRecordIndex + 1 ].tickRate)
        return (
            this.tickRates.length > 1 &&
            this.tickRates[ tpsRecordIndex - 1 ].tickRate * 0.75 < this.tickRates[ tpsRecordIndex ].tickRate &&
            this.tickRates[ tpsRecordIndex ].tickRate * 0.75 < this.tickRates[ tpsRecordIndex + 1 ].tickRate
        )
    }

    getLatestTpsRecord() {
        return this.tickRates.length == 0 ? 0 : this.tickRates.length - 1;
    }

    getAverageTps() {
        return this.tickRates.map(t => t.tickRate).reduce((acc, cur) => acc + cur, 0) / this.tickRates.length || 0
    }

    async upgradeProcessLine() {
        LogParser.prototype.processLine = this.upgradedProcessLine
        await this.server.restartLogParser();
        this.verbose(1, `Upgraded LogParser.processLine()`)
    }

    async upgradedProcessLine(line) {
        // LogParser.prototype.orProcessLine.bind(this.server.logParser)(line) // working (?)
        this.orProcessLine.bind(this.server.logParser)(line)
        this.logLineReceived(line);
    }

    bindListeners() {
        const events = [
            "ADMIN_BROADCAST",
            "CLIENT_CONNECTED",
            "CLIENT_LOGIN",
            "DEPLOYABLE_DAMAGED",
            "NEW_GAME",
            "PENDING_CONNECTION_DESTROYED",
            "PLAYER_CONNECTED",
            "PLAYER_DAMAGED",
            "PLAYER_DIED",
            "PLAYER_DISCONNECTED",
            "PLAYER_POSSESS",
            "PLAYER_REVIVED",
            "PLAYER_UNPOSSESS",
            "PLAYER_WOUNDED",
            "PLAYER_CONTROLLER_CONNECTED",
            "ROUND_ENDED",
            "NEW_GAME",
            "PLAYER_SQUAD_CHANGE",
            "TEAMKILL",
            "PLAYER_CONNECTED",
            "CHAT_MESSAGE",
            "DEPLOYABLE_DAMAGED",
            "ROUND_ENDED"
        ]

        for (const e of events) {
            this.verbose(1, "Binding", e)
            this.server.on(e, (data) => { this.pushEventInTpsHistory(e, data) })
        }
    }
}