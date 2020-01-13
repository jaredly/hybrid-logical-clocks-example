// @flow
type MapCRDT = {
    type: 'map',
    map: { [key: string]: CRDT },
    alive: PlainCRDT<any>,
    hlcStamp: string,
};
type PlainCRDT<T> = {
    type: 'plain',
    value: T,
    hlcStamp: string,
};

// who wins? plain > option > map

type CRDT = MapCRDT | PlainCRDT<any>;

const show = (crdt: CRDT) => {
    if (crdt.type === 'plain') {
        return JSON.stringify(crdt.value) + '=' + crdt.hlcStamp;
    } else {
        const res = [];
        res.push(
            `${crdt.alive.value ? 'alive' : 'dead'}=${crdt.alive.hlcStamp}`,
        );
        Object.keys(crdt.map).forEach(k => {
            res.push(`${k}: ${show(crdt.map[k])}`);
        });
        return `{${res.join(', ')}}=${crdt.hlcStamp}`;
    }
};

const remove = (crdt: CRDT, ts: string): CRDT => {
    if (crdt.type === 'plain') {
        return create<null>(null, ts);
    } else {
        return { ...crdt, alive: create<boolean>(false, ts) };
    }
};

const value = (crdt: CRDT) => {
    if (crdt.type === 'plain') {
        return crdt.value;
    } else if (!crdt.alive.value) {
        return null;
    } else {
        const map = {};
        Object.keys(crdt.map)
            .sort()
            .forEach(k => {
                map[k] = value(crdt.map[k]);
            });
        return map;
    }
};

const createDeepMap = (value: {}, hlcStamp: string): MapCRDT => {
    const map = {};
    Object.keys(value).forEach(k => {
        if (value[k] && typeof value[k] === 'object') {
            map[k] = createDeepMap(value[k], hlcStamp);
        } else {
            map[k] = create(value[k], hlcStamp);
        }
    });
    return { type: 'map', map, hlcStamp, alive: create(true, hlcStamp) };
};

const createMap = (value, hlcStamp): MapCRDT => {
    const map = {};
    Object.keys(value).forEach(k => {
        map[k] = create(value[k], hlcStamp);
    });
    return { type: 'map', map, hlcStamp, alive: create(true, hlcStamp) };
};

const removeAt = (
    map: MapCRDT,
    key: Array<string>,
    hlcStamp: string,
): MapCRDT => {
    return {
        ...map,
        map: {
            ...map.map,
            [key[0]]:
                key.length === 1
                    ? merge(map.map[key[0]], remove(map.map[key[0]], hlcStamp))
                    : // TODO account for plain here I think
                      removeAt(map.map[key[0]], key.slice(1), hlcStamp),
        },
    };
};

const set = (map: MapCRDT, key: Array<string>, value: CRDT): MapCRDT => {
    return {
        ...map,
        map: {
            ...map.map,
            [key[0]]:
                key.length === 1
                    ? map.map[key[0]]
                        ? merge(map.map[key[0]], value)
                        : value
                    : // TODO account for plain here I think
                      set(map.map[key[0]], key.slice(1), value),
        },
    };
};

const create = function<T>(value: T, hlcStamp: string): PlainCRDT<T> {
    return { type: 'plain', value, hlcStamp };
};

const mergeMaps = (one: MapCRDT, two: MapCRDT) => {
    const map = {};
    Object.keys(one.map).forEach(k => {
        map[k] = two.map[k] ? merge(one.map[k], two.map[k]) : one.map[k];
    });
    Object.keys(two.map).forEach(k => {
        map[k] = one.map[k] ? merge(one.map[k], two.map[k]) : two.map[k];
    });
    return {
        type: 'map',
        map,
        hlcStamp: one.hlcStamp > two.hlcStamp ? one.hlcStamp : two.hlcStamp,
        alive: mergePlain(one.alive, two.alive),
    };
};

// I don't love this...
const mergePlainAndMap = (map: MapCRDT, plain: PlainCRDT<any>) => {
    throw new Error('Schema change detected! Invalid state');
};
const mergePlain = (one: PlainCRDT<any>, two: PlainCRDT<any>) => {
    return one.hlcStamp > two.hlcStamp ? one : two;
};
const merge = (one: CRDT, two: CRDT): CRDT => {
    if (one.type === 'map' && two.type === 'map') {
        return mergeMaps(one, two);
    }
    if (one.type === 'map' && two.type === 'plain') {
        return mergePlainAndMap(one, two);
    }
    if (two.type === 'map' && one.type === 'plain') {
        return mergePlainAndMap(two, one);
    }
    // $FlowFixMe I've exhausted the options folks.
    return mergePlain(one, two);
};

module.exports = {
    merge,
    value,
    create,
    createDeepMap,
    set,
    remove,
    removeAt,
    show,
};
