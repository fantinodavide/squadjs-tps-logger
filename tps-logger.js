import DiscordBasePlugin from './discord-base-plugin.js';

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
        };
    }

    constructor(server, options, connectors) {
        super(server, options, connectors);

        this.broadcast = this.server.rcon.broadcast(msg);
        this.warn = this.server.rcon.warn(steamid, msg);
    }

    async mount() {
    }

    async unmount() {
        this.verbose(1, 'TpsLogger unmounted');
    }
}