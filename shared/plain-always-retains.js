// @flow
// Ok so I'm having a realization, and that is this:
// if uhhh maybe the "simplest" way to do things, and maybe most user-friendly
// would be to un-delete things if you set an inner value.
// At least, under this current scheme where I want Maps and Plain values to be able
// to coexist.
// So that means: a plain value that replaces a map will always hang on to the whole map
// it's replacing, in case it needs to re-animate it.
// And the hlcStamp of a MapCRDT is always at least the max() of the hlcStamps of its children.
// So, I don't love that this royally gets in the way of garbage collection.

// Am I missing something though?
// Oh maybe I am. Because the scenario where we might be setting a value on a plain, is that
// there's a "create" event somewhere else that we just haven't seen yet.
// Orr just that you deleted, then I changed an attribute, and then we synced. hrm ok.

// So I thkn we have two alternatives. Plain Always Wins, or Plain Always Retains.

type MapCRDT = {|
    type: 'map',
    map: { [key: string]: CRDT },
    hlcStamp: string,
|};
type PlainCRDT = {|
    type: 'plain',
    value: string | number | any,
    hlcStamp: string,
    mapValues?: { [key: string]: CRDT },
|};

type CRDT = MapCRDT | PlainCRDT;

const showMap = map => {
    const res = [];
    Object.keys(map).forEach(k => {
        res.push(`${k}: ${show(map[k])}`);
    });
    return res;
};

const show = (crdt: CRDT) => {
    if (crdt.type === 'plain') {
        return (
            crdt.hlcStamp +
            '-' +
            JSON.stringify(crdt.value) +
            (crdt.mapValues ? `{${showMap(crdt.mapValues).join(',')}}` : '')
        );
    } else {
        return `${crdt.hlcStamp}-{${showMap(crdt.map).join(', ')}}`;
    }
};

const value = (crdt: CRDT) => {
    if (crdt.type === 'plain') {
        return crdt.value;
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

const remove = (crdt: CRDT, ts: string): CRDT => {
    return create(null, ts);
};

const notAMap = (v, msg) => {
    throw new Error(`Not a map, cannot ${msg}: ${show(v)}`);
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
                    : map.map[key[0]].type === 'map'
                    ? removeAt(map.map[key[0]], key.slice(1), hlcStamp)
                    : notAMap(map.map[key[0]], 'removeAt'),
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
                    : map.map[key[0]].type === 'map'
                    ? set(map.map[key[0]], key.slice(1), value)
                    : notAMap(map.map[key[0]], 'set'),
        },
        hlcStamp: value.hlcStamp > map.hlcStamp ? value.hlcStamp : map.hlcStamp,
    };
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
    return { type: 'map', map, hlcStamp };
};

const createMap = (value, hlcStamp): MapCRDT => {
    const map = {};
    Object.keys(value).forEach(k => {
        map[k] = create(value[k], hlcStamp);
    });
    return { type: 'map', map, hlcStamp };
};
const create = (value: any, hlcStamp: string): PlainCRDT => {
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
    };
};
const mergePlainAndMap = (map: MapCRDT, plain: PlainCRDT): CRDT => {
    if (map.hlcStamp > plain.hlcStamp) {
        if (plain.mapValues) {
            const mapValues = plain.mapValues;
            const res = {};
            Object.keys(map.map).forEach(k => {
                res[k] = mapValues[k]
                    ? merge(map.map[k], mapValues[k])
                    : map.map[k];
            });
            // TODO deduplicate the work here
            Object.keys(mapValues).forEach(k => {
                res[k] = map.map[k]
                    ? merge(map.map[k], mapValues[k])
                    : mapValues[k];
            });
            return { map: res, hlcStamp: map.hlcStamp, type: 'map' };
        } else {
            return map;
        }
    }
    const mapValues = { ...plain.mapValues };
    // ooh ok merge in the plain's potential
    Object.keys(map.map).forEach(k => {
        if (mapValues[k]) {
            mapValues[k] = merge(mapValues[k], map.map[k]);
        } else if (map.map[k].hlcStamp > plain.hlcStamp) {
            // ooooh ok so when I update an inner thing, I think I need to update the hlcStamp of the outer thing?
            // huh maybe I don't love that.
            // that would mean that setting a value would "undelete" the map.
            // but maybe that's fine?
            // it just means I can't prune things like maybe I wanted to.
        }
        if (
            map.map[k].hlcStamp > plain.hlcStamp &&
            (!mapValues[k] || mapValues[k].hlcStamp < map.map[k].hlcStamp)
        ) {
            mapValues[k] = map.map[k];
        }
    });
    return { ...plain, mapValues };
};
const mergePlain = (one: PlainCRDT, two: PlainCRDT): PlainCRDT => {
    // TODO merge mapValues here
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
