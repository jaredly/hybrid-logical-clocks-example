// @flow
// idempotent, associative, and commutative. A replicated object satisfying this property (called monotonic semi-lattice property in the paper) is one type of CRDT, namely CvRDT — convergent replicated data type.
// idempotent  = merge(a, merge(a, b)) === merge(a, b)
// commutative = merge(a, b)           === merge(b, a)
// associative = merge(a, merge(b, c)) === merge(merge(a, b), c)

// ok so the map we have, each item needs a timestamp, right?
// yeah so you know whether to apply the deal.
type CRDTMapInner = { [key: string]: { hlcStamp: string, value: any } };
// you might think it's excessive, and maybe it is folks.

type WithStamp = <V>(V) => { hlcStamp: string, value: V };

class CRDTMap<T: {}> {
    value: $ObjMap<T, WithStamp>;
    constructor(value: T, t: string) {
        this.value = {};
        Object.keys(value).forEach(k => {
            this.value[k] = { hlcStamp: t, value: value[k] };
        });
    }

    get(k: $Keys<T>) {
        return this.value[k].value;
    }

    set(k: $Keys<T>, value, hlcStamp: string) {
        if (hlcStamp > this.value[k].hlcStamp) {
            this.value[k] = { hlcStamp, value };
        }
    }
}

const setFull = (map, key, value, hlcStamp) => {
    return { ...map, [key]: { value, hlcStamp } };
};

const set = (map, key, value, hlcStamp) => {
    return {
        v: { ...map.v, [key]: value },
        t: { ...map.t, [key]: hlcStamp },
    };
};

const createFull = (map, hlcStamp) => {
    const res = { $alive: { value: true, hlcStamp } };
    Object.keys(map).forEach(k => {
        res[k] = { value: map[k], hlcStamp };
    });
    return res;
};

const create = (map, hlcStamp) => {
    const res = { v: {}, t: { $alive: { value: true, hlcStamp } } };
    Object.keys(map).forEach(k => {
        res.v[k] = map[k];
        res.t[k] = hlcStamp;
    });
    return res;
};

const mergeAttribute = (one, two) => {
    if (!one) return two;
    if (!two) return one;
    return one.hlcStamp < two.hlcStamp ? two : one;
};

const mergeFull = (one, two) => {
    const res = {};
    Object.keys(one).forEach(k => {
        res[k] = mergeAttribute(one[k], two[k]);
    });
    Object.keys(two).forEach(k => {
        res[k] = mergeAttribute(one[k], two[k]);
    });
    return res;
};

const merge = (one, two) => {
    const res = {
        v: {},
        t: { $alive: mergeAttribute(one.t['$alive'], two.t['$alive']) },
    };
    Object.keys(one.v).forEach(k => {
        res[k] = mergeAttribute(one[k], two[k]);
    });
    Object.keys(two.v).forEach(k => {
        res[k] = mergeAttribute(one[k], two[k]);
    });
};

type MapCRDT = {
    type: 'map',
    map: { [key: string]: CRDT },
    hlcStamp: string,
};
type PlainCRDT = {
    type: 'plain',
    value: string | number | any,
    hlcStamp: string,
    mapValues?: { [key: string]: CRDT },
};

type CRDT = MapCRDT | PlainCRDT;

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

const tryy = () => {
    const createMap = (value, hlcStamp): MapCRDT => {
        const map = {};
        Object.keys(value).forEach(k => {
            map[k] = create(value[k], hlcStamp);
        });
        return { type: 'map', map, hlcStamp };
    };
    const create = (value, hlcStamp): PlainCRDT => {
        return { type: 'plain', value, hlcStamp };
    };
    const mergeMaps = (one: MapCRDT, two: MapCRDT) => {
        const map = {};
        Object.keys(one.map).forEach(k => {
            map[k] = merge(one.map[k], two.map[k]);
        });
        Object.keys(one.map).forEach(k => {
            map[k] = merge(one.map[k], two.map[k]);
        });
        return {
            type: 'map',
            map,
            hlcStamp: one.hlcStamp > two.hlcStamp ? one.hlcStamp : two.hlcStamp,
        };
    };
    const mergePlainAndMap = (map: MapCRDT, plain: PlainCRDT) => {
        if (map.hlcStamp > plain.hlcStamp) {
            if (plain.mapValues) {
                const mapValues = plain.mapValues;
                const res = {};
                Object.keys(map.map).forEach(k => {
                    res[k] = merge(map.map[k], mapValues[k]);
                });
                // TODO deduplicate the work here
                Object.keys(mapValues).forEach(k => {
                    res[k] = merge(map.map[k], mapValues[k]);
                });
                return { map: res, hlcStamp: map.hlcStamp };
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
    const mergePlain = (one: PlainCRDT, two: PlainCRDT) => {
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
};

/*

// full, in-line representation
const map = {
    x: {value: 1, hlcStamp: 's1'},
    y: {value: 2, hlcStamp: 's2'},
    z: {value: false, hlcStamp: 's3'},
    $alive: {value: true, hlcStamp: 's4'},
}
const deletedMap = {
    x: {value: 5, hlcStamp: 's6'},
    y: {value: 2, hlcStamp: 's2'},
    z: {value: false, hlcStamp: 's3'},
    $alive: {value: false, hlcStamp: 's5'},
}
const nestedMap = {
    x: {value: 1, hlcStamp: 's1'},
    person: {
        name: {value: 'Julia', hlcStamp: 's1'},
        address: {value: '123 Place', hlcStamp: 's1'},
        $alive: {value: true, hlcStamp: 's1'},
    },
    $alive: {value: true, hlcStamp: 's1'}
}
// and we need, like, schema metadata.... right?
// or I guess we could just infer it based on the shape of things...
// and then it would be an error to change the type of a value?

// OK so maybe the rule is just:: 'plain' wins over 'map'? Like merging a plain v with a map, regardless of stamps, the plain wins?
// that's a decent rule I guess. It would torch you if you make a mistake though.

// another option would be to do the "hang on to metadata" thing ... which honestly would
// make the "deletion" handling potentially kinda elegant. hmmm
const mapWithStringThatUsedToBeMap = {
    x: {value: 1, hlcStamp: 's1'},
    // because this is obviously a nested map, from the `$alive` key
    person: {
        value: 'Jules',
        hlcStamp: 's2',
        mapAttributes: {
            name: {value: 'Jules', hlcStamp: 's10'},
            address: {value: '123 Place', hlcStamp: 's1'},
            $alive: {value: true, hlcStamp: 's1'},
        }
    },
    $alive: {value: false, hlcStamp: 's2'}
}
// Sooo then the "map" values would be wrapped, if they are going to be deletable.
const deletedMap = {
    value: null,
    hlcStamp: 's2',
    mapAttributes: {x: 5, hlcStamp: 's5'} // any attributes that are "newer" than the top level stamp.
}
/// huhhhh that seems a little too tidy to me. Could it be that easy?



const deletedNestedMap = {
    x: {value: 1, hlcStamp: 's1'},
    // because this is obviously a nested map, from the `$alive` key
    person: {
        name: {value: 'Jules', hlcStamp: 's10'},
        address: {value: '123 Place', hlcStamp: 's1'},
        $alive: {value: true, hlcStamp: 's1'},
    },
    $alive: {value: false, hlcStamp: 's2'}
}

// a representation that optimizes for direct use in javascript.
// `v` is the "plain js object"
const map = {
    v: {x: 1, y: 2, z: false},
    t: {x: 's1', y: 's2', z: 's3', $alive: {value: true, hlcStamp: 's4'}},
}
const deletedMap = {
    v: null,
    t: {x: 's6', y: 's2', z: 's3', $alive: {value: false, hlcStamp: 's5'}, $pending: {x: 5}},
}
const nestedMap = {
    v: {x: 1, person: {name: 'Julia', address: '123 Place'}},
    t: {
        x: 's1',
        person: {
            name: 's1',
            address: 's1',
            $alive: {value: true, hlcStamp: 's1'}
        },
        $alive: {value: true, hlcStamp: 's1'}
    },
}
const nestedMap = {
    v: {x: 1, person: {name: 'Jules', address: '123 Place'}},
    t: {
        x: 's1',
        person: {
            name: 's10',
            address: 's1',
            $alive: {value: true, hlcStamp: 's1'}
        },
        $alive: {value: false, hlcStamp: 's2'}
    },
}
// I'd want to ~prove that this representation still satisfies all the properties.


*/

// const v: { a: number, b: string } = { a: 0, b: 'hi' };
// const m = new CRDTMap(v, '000');
// const a: string = m.get('a');
// m.set('a', 'hi', '000');

type CRDT =
    | {
          type: 'create',
          path: Array<string>,
          value: any,
      }
    | {
          type: 'delete',
          path: Array<string>,
      }
    | {
          type: 'update',
          path: Array<string>,
          value: any,
      }
    // | {
    //       type: 'ot',
    //       path: Path,
    //       ops: Array<any>,
    //   }
    | {
          type: 'insert',
      };
