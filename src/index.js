// @flow
import React from 'react';
import { render } from 'react-dom';

import * as hlc from './hlc';
import type { HLC } from './hlc';

type State = {|
    nodes: { [key: string]: NodeT },
    trueIdx: number,
|};

type NodeT = {|
    id: string,
    clock: HLC,
    events: Array<Event>,
    now: number,
    counter: number,
|};
type Event = {|
    id: string,
    clock: HLC,
    trueIdx: number,
|};

const createNode = nodeId => {
    return {
        id: nodeId,
        clock: hlc.init(nodeId, 499),
        events: [],
        now: 500,
        counter: 1,
    };
};

const hoursMinutes = ts => `${Math.floor(ts / 60)}:${ts % 60}`;

const toString = ({ ts, count, node }: HLC) =>
    `${hoursMinutes(ts)} - ${count} - ${node}`;

const initial = {
    nodes: { a: createNode('a'), b: createNode('b'), c: createNode('c') },
    trueIdx: 0,
};

const compareEvents = (one: Event, two: Event) => hlc.cmp(one.clock, two.clock);

const addEvent = (node: NodeT, trueIdx: number): NodeT => {
    const clock = hlc.inc(node.clock, node.now);
    const event = { id: node.id + node.counter, clock, trueIdx };
    const events = node.events.concat([event]);
    return { ...node, counter: node.counter + 1, clock, events };
};

type Action =
    | { type: 'set-clock', node: string, now: number }
    | { type: 'send', clock: HLC, src: string, dest: string }
    | { type: 'event', nodes: Array<string> };

const reducer = (state: State, action: Action) => {
    switch (action.type) {
        case 'set-clock':
            return {
                ...state,
                nodes: {
                    ...state.nodes,
                    [action.node]: {
                        ...state.nodes[action.node],
                        now: action.now,
                    },
                },
            };
        case 'event':
            const trueIdx = state.trueIdx;
            const res = {
                ...state,
                nodes: { ...state.nodes },
                trueIdx: trueIdx + 1,
            };
            action.nodes.forEach(nid => {
                res.nodes[nid] = addEvent(res.nodes[nid], trueIdx);
            });
            Object.keys(res.nodes).forEach(nid => {
                res.nodes[nid] = {
                    ...res.nodes[nid],
                    now: res.nodes[nid].now + 1,
                };
            });
            return res;
        case 'send':
            const res2 = { ...state, nodes: { ...state.nodes } };
            res2.nodes[action.dest] = {
                ...res2.nodes[action.dest],
                clock: hlc.recv(
                    res2.nodes[action.dest].clock,
                    action.clock,
                    res2.nodes[action.dest].now,
                ),
            };
            return res2;
    }
    return state;
};

const Node = ({ node, setClock, addEvent, ids, send }) => {
    return (
        <div style={{ padding: 8 }}>
            <div style={{ fontWeight: '600' }}>Node {node.id}</div>
            <div>
                <span>Local "now": </span>
                <input
                    type="number"
                    min="0"
                    max="60"
                    style={{ textAlign: 'right' }}
                    value={Math.floor(node.now / 60)}
                    onChange={evt => {
                        const v = +evt.target.value;
                        const rest = node.now % 60;
                        setClock(v * 60 + rest);
                    }}
                />
                {':'}
                <input
                    type="number"
                    min="0"
                    max="60"
                    value={node.now % 60}
                    onChange={evt => {
                        const v = +evt.target.value;
                        const minutes = Math.floor(node.now / 60);
                        setClock(minutes * 60 + v);
                    }}
                />
            </div>
            <div>Local HLC {toString(node.clock)}</div>
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                }}
            >
                <button onClick={() => addEvent()} style={{ marginTop: 4 }}>
                    Add event
                </button>
                {ids
                    .filter(id => id !== node.id)
                    .map(id => (
                        <button
                            onClick={() => send(id)}
                            style={{ marginTop: 4 }}
                        >
                            Send local HLC to {id}
                        </button>
                    ))}
            </div>
            <div>
                {node.events.map(evt => (
                    <div>
                        {evt.id} : {toString(evt.clock)} : {evt.trueIdx}
                    </div>
                ))}
            </div>
        </div>
    );
};

const App = () => {
    const [state, dispatch] = React.useReducer(reducer, initial);
    React.useReducer;

    return (
        <div>
            <span>
                When you add an event, by default all "now"s (wall clocks)
                increment by one.
            </span>
            <div style={{ display: 'flex' }}>
                {Object.keys(state.nodes).map(nid => (
                    <Node
                        node={state.nodes[nid]}
                        ids={Object.keys(state.nodes)}
                        send={id =>
                            dispatch({
                                type: 'send',
                                src: nid,
                                clock: state.nodes[nid].clock,
                                dest: id,
                            })
                        }
                        setClock={now =>
                            dispatch({ type: 'set-clock', node: nid, now })
                        }
                        addEvent={() =>
                            dispatch({ type: 'event', nodes: [nid] })
                        }
                    />
                ))}
                <div style={{ padding: 8 }}>
                    <strong>All events in the system</strong>
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns:
                                'min-content min-content min-content min-content',
                            alignSelf: 'flex-start',
                        }}
                    >
                        <div style={{ display: 'contents' }}>
                            <span style={{ whiteSpace: 'nowrap', padding: 8 }}>
                                HLC TS
                            </span>
                            <span style={{ whiteSpace: 'nowrap', padding: 8 }}>
                                HLC Counter
                            </span>
                            <span style={{ whiteSpace: 'nowrap', padding: 8 }}>
                                Nodeid
                            </span>
                            <span style={{ whiteSpace: 'nowrap', padding: 8 }}>
                                True index
                            </span>
                        </div>
                        {[]
                            .concat(
                                ...Object.keys(state.nodes).map(
                                    nid => state.nodes[nid].events,
                                ),
                            )
                            .sort(compareEvents)
                            .map(evt => (
                                <div style={{ display: 'contents' }}>
                                    <div>{hoursMinutes(evt.clock.ts)}</div>
                                    <div>{evt.clock.count}</div>
                                    <div>{evt.clock.node}</div>
                                    <div>{evt.trueIdx}</div>
                                </div>
                            ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

const el = document.getElementById('root');
if (el) {
    render(<App />, el);
}
