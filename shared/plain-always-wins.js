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

export type CRDT = MapCRDT | PlainCRDT<any>;

export type Delta =
    | { type: 'replace', value: any, hlcStamp: string }
    | {
          type: 'set',
          path: Array<string>,
          value: CRDT,
          // Do I need a separate hlcStamp for the operation itself?
      }
    | { type: 'remove', hlcStamp: string }
    | {
          type: 'removeAt',
          path: Array<string>,
          hlcStamp: string,
      };

const showDelta = (delta: Delta) => {
    switch (delta.type) {
        case 'replace':
            return `<replace> ${delta.hlcStamp} ${show(delta.value)}`;
        case 'remove':
            return `<remove> ${delta.hlcStamp}`;
        case 'removeAt':
            return `<removeAt> ${delta.hlcStamp} ${delta.path.join(':')}`;
        case 'set':
            return `<set> ${delta.path.join(':')} ${show(delta.value)}`;
    }
};

const deltas = {
    set: (path: Array<string>, value: CRDT) => ({ type: 'set', path, value }),
    removeAt: (path: Array<string>, hlcStamp: string) => ({
        type: 'removeAt',
        path,
        hlcStamp,
    }),
};

const applyDelta = (crdt: CRDT, delta: Delta): CRDT => {
    switch (delta.type) {
        case 'remove':
            return merge(crdt, remove(crdt, delta.hlcStamp));
        case 'removeAt':
            if (crdt.type === 'map') {
                return removeAt(crdt, delta.path, delta.hlcStamp);
            } else {
                return crdt;
                // throw new Error('Not a map, cant remove')
            }
        case 'replace':
            return merge(crdt, create(delta.value, delta.hlcStamp));
        case 'set':
            if (crdt.type === 'map') {
                return set(crdt, delta.path, delta.value);
            } else {
                return crdt;
                // throw new Error('Not a map, cant remove')
            }
    }
    throw new Error('unknown delta type');
};

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
                    : map.map[key[0]].type === 'plain'
                    ? map.map[key[0]]
                    : removeAt(map.map[key[0]], key.slice(1), hlcStamp),
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
                    : map.map[key[0]].type === 'plain'
                    ? map.map[key[0]]
                    : set(map.map[key[0]], key.slice(1), value),
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

// how bout that, plain always wins.
const mergePlainAndMap = (map: MapCRDT, plain: PlainCRDT<any>) => {
    return plain;
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
    deltas,
    applyDelta,
    showDelta,
};
