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
                default: 30
            }
        };
    }

    constructor(server, options, connectors) {
        super(server, options, connectors);

        this.tickRates = []

        this.upgradeEmitter = this.upgradeEmitter.bind(this)
        this.tickRateUpdated = this.tickRateUpdated.bind(this)
        this.httpServer = this.httpServer.bind(this)

        this.broadcast = this.server.rcon.broadcast;
        this.warn = this.server.rcon.warn;
    }

    async mount() {
        this.upgradeEmitter();
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

    upgradeEmitter() {
        const _emit = this.server.emit;
        this.server.emit = (eventName, data, ...more) => {
            this.verbose(1, 'Event', eventName)
            this.tickRates[ this.tickRates.length - 1 ].events.push({ eventName: eventName, data: data })

            return _emit(eventName, data, ...more)
        }

        this.verbose(1, 'EventEmitter Upgraded')
    }

    async tickRateUpdated(dt) {
        this.verbose(1, 'TPS Update', dt)
        this.tickRates.push({ tickRate: dt.tickRate, time: dt.time, events: [] })
        if (this.tickRates.length > this.options.tpsHistoryLength) this.tickRates.shift();
    }
}