import DiscordBasePlugin from './discord-base-plugin.js';
import SocketIOAPI from './socket-io-api.js';
import LogParser from '../../core/log-parser/index.js';
import { MessageAttachment } from "discord.js";

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
            channelID: {
                required: true,
                description: 'The ID of the channel to send logs to.',
                default: '',
                example: '667741905228136459'
            },
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
            useSocketIoPluginHttpServer: {
                required: false,
                description: 'If set to true the output will be served over the HTTP server started by the Socket-io SquadJS plugin.',
                default: true
            },
            outputHttpPath: {
                required: false,
                description: '',
                default: "/tpslogs"
            },
            httpServerPort: {
                required: false,
                description: "The port used by the http server",
                default: 3030
            },
            tpsHistoryLength: {
                required: false,
                description: "",
                default: 720
            },
            simulateTpsDrops: {
                required: false,
                description: "",
                default: false
            }
        };
    }

    constructor(server, options, connectors) {
        super(server, options, connectors);

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
        this.matchProfilerLog = this.matchProfilerLog.bind(this);
        this.roundEnded = this.roundEnded.bind(this);
        this.roundStarted = this.roundStarted.bind(this);
        this.isTpsDrop = this.isTpsDrop.bind(this);

        this.broadcast = this.server.rcon.broadcast;
        this.warn = this.server.rcon.warn;
    }

    async mount() {
        this.server.logParser.logReader.reader.on('line', this.logLineReceived)

        this.httpServer();

        this.server.on('TICK_RATE', this.tickRateUpdated)
        this.server.on('ROUND_ENDED', this.roundEnded)
        this.server.on('NEW_GAME', this.roundStarted)


        // setTimeout(this.roundEnded, 2000)
    }

    async unmount() {
        this.verbose(1, 'TpsLogger unmounted');
    }

    async roundStarted(info) {
        setTimeout(async () => {
            await this.sendDiscordMessage({
                embed: {
                    title: `TPS Logs Started`,
                    fields: [
                        {
                            name: 'LayerID',
                            value: this.server.currentLayer.layerid || 'Unknown',
                            inline: false
                        },
                        {
                            name: 'Player Count',
                            value: this.server.players.length,
                            inline: false
                        },
                    ]
                },
                timestamp: (new Date()).toISOString()
            });
        }, 20_000)
    }
    async roundEnded(info) {
        setTimeout(async () => {
            const latestTickrate = this.tickRates[ this.getLatestTpsRecord() ];
            const latestPlayerCount = this.server.players.length;
            await this.sendDiscordMessage({
                files: [
                    new MessageAttachment(Buffer.from(JSON.stringify(this.tickRates, null, 2)), 'TPS_History.json')
                ]
            })
            this.tickRates = [];
            await this.sendDiscordMessage({
                embed: {
                    title: `TPS Logs Ended`,
                    fields: [
                        {
                            name: 'LayerID',
                            value: latestTickrate.layer,
                            inline: false
                        },
                        {
                            name: 'Player Count',
                            value: latestPlayerCount,
                            inline: false
                        },
                        {
                            name: 'Latest Average TPS',
                            value: latestTickrate.averageTickRate,
                            inline: false
                        },
                    ]
                },
                timestamp: (new Date()).toISOString()
            });
        }, 15_000)
    }

    httpServer() {
        if (this.options.httpServerEnabled) {
            if (this.options.useSocketIoPluginHttpServer) {
                let socketIo = this.server.plugins.find(p => p instanceof SocketIOAPI);

                socketIo.httpServer.on('request', async (req, res) => {
                    this.verbose(2, 'Request', req.url)
                    if (req.method == 'GET' && req.url == '/' + this.options.outputHttpPath.replace(/^\//, '')) {
                        this.verbose(1, `Sending response to "${req.url}"`)
                        res.setHeader('Content-Type', 'application/json');
                        res.write(JSON.stringify(this.tickRates, null, 2))
                        res.end();
                    }
                })
            } else {
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
    }

    pushEventInTpsHistory(name, data) {
        const index = this.tickRates.length == 0 ? 0 : this.tickRates.length - 1;
        if (!this.tickRates[ index ]) return;
        this.tickRates[ index ].events.push({ eventName: name, data: data })
    }

    tickRateUpdated(dt) {
        const prevTps = this.tickRates[ this.getLatestTpsRecord() ]?.tickRate || 50
        const tps = this.options.simulateTpsDrops && prevTps > 25 ? 25 : dt.tickRate;
        this.verbose(1, 'TPS Update', tps, dt.time)
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
        this.tickRates[ latestTpsRecordIndex ].id = latestTpsRecordIndex;
        if (this.isTpsDrop(latestTpsRecordIndex)) {
            this.verbose(1, 'Emitting TPS_DROP event')
            this.server.emit('TPS_DROP', this.tickRates[ latestTpsRecordIndex ])
        }
        this.clearLogHistoryInTpsRecord(latestTpsRecordIndex - 1)
    }

    isTpsDrop(latestTpsRecordIndex) {
        return this.tickRates[ latestTpsRecordIndex - 1 ].tickRate * 0.75 > this.tickRates[ latestTpsRecordIndex ].tickRate
    }

    async logLineReceived(dt) {
        this.verbose(2, `Received log line`, dt)
        this.pushLogInTpsHistory(dt)
        this.matchProfilerLog(dt);
    }

    pushLogInTpsHistory(log) {
        // this.verbose(2, `Adding log to tps history`)
        const index = this.getLatestTpsRecord();
        if (!this.tickRates[ index ]) return;
        this.tickRates[ index ].logs.history.push(log);
        this.tickRates[ index ].logs.count++;
    }

    clearLogHistoryInTpsRecord(tpsRecordIndex) {
        this.verbose(2, `Checking permission to clear log history ${tpsRecordIndex}`)
        if (tpsRecordIndex < 0 || tpsRecordIndex >= this.tickRates.length) return;
        if (!this.canClearLog(tpsRecordIndex)) return;
        this.verbose(2, `Clearing log history ${tpsRecordIndex}`)
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
        const sliceLength = Math.min(this.tickRates.length, 10);
        return this.tickRates.slice(this.tickRates.length - sliceLength).map(t => t.tickRate).reduce((acc, cur) => acc + cur, 0) / sliceLength || 0
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

    matchProfilerLog(line) {
        let regex = /LogCsvProfiler\: Display\: Capture (?<state>\w+)(. CSV ID: (?<csv_id>\w+))?(. Writing CSV to file : (?<csv_file_path>.+))?/
        let match = line.match(regex);
        if (match) {
            const event = `CSV_PROFILER_${match.groups.state.toUpperCase()}`;
            this.server.emit(event, match)
            this.verbose(1, 'Emitting event', event)
        }

        regex = /LogCsvProfiler: Warning: Capture Stop requested, but no capture was running!/
        match = line.match(regex);
        if (match) {
            const event = `CSV_PROFILER_ALREADY_STOPPED`;
            this.server.emit(event, match)
            this.verbose(1, 'Emitting event', event)
        }
    }
}