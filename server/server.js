// @flow
import type {
    ServerMessage,
    ClientMessage,
    Event,
    ClientEvent,
} from '../shared/types';

// I'm ambivalent about doing this on every client connect -- probably
// better to just do periodically as a "garbage collection step"
const compact = (events, crdtKey) => {
    // go back and find out which messages have been superceeded?
    // as we do that, we should set a bit on a message, marking it as "garbage".
    const seen = {};
    const good = [];
    for (let i = events.length - 1; i >= 0; i--) {
        const key = crdtKey(events[i]);
        if (!seen[key]) {
            seen[key] = true;
            good.unshift(events[i]);
        } else {
            // TODO track these so we can persist this?
            events[i].superceeded = true;
        }
    }
    return good;
};

type Config<CRDT, Data> = {
    apply: (Data, CRDT) => Data,
};

type Client<CRDT, Data> = {
    send: (ServerMessage<CRDT, Data>) => void,
    id: string,
};

export class Server<CRDT, Data> {
    events: Array<Event<CRDT>>;
    data: Data;
    latestIdx: number;
    clients: Array<Client<CRDT, Data>>;
    config: Config<CRDT, Data>;

    constructor(
        data: Data,
        events: Array<Event<CRDT>>,
        config: Config<CRDT, Data>,
    ) {
        this.config = config;
        this.events = [];
        this.data = data;
        this.latestIdx = events[events.length - 1].idx;
    }

    addEvents(clientId: string, events: Array<ClientEvent<CRDT>>) {
        // apply the events to the data
        events.forEach(event => {
            // TODO persist folks
            this.data = this.config.apply(this.data, event.change);
        });
        const serverEvents = events.map((evt, i) => ({
            clientEvent: evt,
            idx: i + 1 + this.latestIdx,
            superceeded: false,
        }));
        this.latestIdx = serverEvents[serverEvents.length - 1].idx;
        this.events.push(...serverEvents);
        this.clients.forEach(client => {
            if (client.id !== clientId) {
                client.send({ type: 'events', events: serverEvents });
            }
        });
    }

    onClientMessage(id: string, message: ClientMessage<CRDT>) {
        const client = this.clients.find(c => c.id === id);
        if (!client) {
            console.log('Unexpected client id', id);
            return; // unknown client id
        }
        if (message.type === 'hello') {
            client.send({ type: 'init', data: this.data });
        } else if (message.type === 'sync') {
            const toSend = this.events.slice(message.lastSeen || 0);
            client.send({ type: 'events', events: toSend });
        } else if (message.type === 'events') {
            this.addEvents(client.id, message.events);
        }
    }
}
