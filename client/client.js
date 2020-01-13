// @flow
import type {
    ServerMessage,
    ClientMessage,
    Event,
    ClientEvent,
} from '../shared/types';

type ChangeId = string;

type Config<CRDT, Data> = {
    apply: (Data, CRDT) => [Data, Array<ChangeId>],
    notifyChanges: (Array<ChangeId>) => void,
};

// type Client<CRDT, Data> = {
//     send: (ServerMessage<CRDT, Data>) => void,
//     id: string,
// };

// NOTE This currently has no persistence.
export class Client<CRDT, Data> {
    data: ?Data;
    config: Config<CRDT, Data>;
    send: (ClientEvent<CRDT>) => void;
    lastSeenServerIdx: number;

    constructor(config: Config<CRDT, Data>, send: (ClientEvent<CRDT>) => void) {
        this.config = config;
        this.send = send;
        this.lastSeenServerIdx = 0;
        this.data = null;
    }

    addEvents(data: Data, events: Array<Event<CRDT>>) {
        if (!events.length) {
            return;
        }
        const allChanges = [];
        events.forEach(event => {
            let newChanges;
            [data, newChanges] = this.config.apply(
                data,
                event.clientEvent.change,
            );
            allChanges.push(...newChanges);
        });
        this.data = data;
        this.lastSeenServerIdx = events[events.length - 1].idx;
        this.config.notifyChanges(allChanges);
    }

    onMessage(message: ServerMessage<CRDT, Data>) {
        if (message.type === 'init') {
            this.data = message.data;
        } else if (message.type === 'events') {
            if (!this.data) {
                throw new Error('messages received in the wrong order');
            }
            this.addEvents(this.data, message.events);
        }
    }
}
