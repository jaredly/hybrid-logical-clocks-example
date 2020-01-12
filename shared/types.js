// @flow

export type ServerMessage<CRDT, Data> =
    | {
          type: 'init',
          data: Data,
      }
    | {
          type: 'events',
          events: Array<Event<CRDT>>,
      };

export type ClientEvent<CRDT> = {
    clientId: string,
    change: CRDT,
    hlcStamp: string,
};

export type Event<CRDT> = {
    clientEvent: ClientEvent<CRDT>,
    idx: number,
    superceeded: boolean,
};

export type ClientMessage<CRDT> =
    | { type: 'hello' }
    | {
          type: 'sync',
          lastSeen: ?number,
      }
    | {
          type: 'events',
          events: Array<ClientEvent<CRDT>>,
      };
