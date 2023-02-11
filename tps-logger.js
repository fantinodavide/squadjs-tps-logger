import DiscordBasePlugin from './discord-base-plugin.js';
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
                default: 50
            }
        };
    }

    constructor(server, options, connectors) {
        super(server, options, connectors);

        this.tickRates = []

        this.tickRateUpdated = this.tickRateUpdated.bind(this)
        this.httpServer = this.httpServer.bind(this)
        this.pushEventInTpsHistory = this.pushEventInTpsHistory.bind(this)
        this.bindListeners = this.bindListeners.bind(this);

        this.broadcast = this.server.rcon.broadcast;
        this.warn = this.server.rcon.warn;
    }

    async mount() {
        this.bindListeners();
        this.httpServer();

        this.server.on('TICK_RATE', this.tickRateUpdated)
        // this.server.on('CHAT_MESSAGE', (...a) => { console.log(...a) })
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
        // console.log(more)
        const index = this.tickRates.length == 0 ? 0 : this.tickRates.length - 1;
        if (!this.tickRates[ index ]) this.tickRates[ index ] = { tickRate: 0, time: 0, events: [] }
        this.tickRates[ index ].events.push({ eventName: name, data: data })
    }

    async tickRateUpdated(dt) {
        this.verbose(1, 'TPS Update', dt)
        this.tickRates.push({ tickRate: dt.tickRate, time: dt.time, playerCount: this.server.players.length, layer: this.server.currentLayer.layerid, events: [] })
        if (this.tickRates.length > this.options.tpsHistoryLength) this.tickRates.shift();
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