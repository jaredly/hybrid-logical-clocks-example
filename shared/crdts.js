// @flow
// idempotent, associative, and commutative. A replicated object satisfying this property (called monotonic semi-lattice property in the paper) is one type of CRDT, namely CvRDT — convergent replicated data type.
// idempotent  = merge(a, merge(a, b)) === merge(a, b)
// commutative = merge(a, b)           === merge(b, a)
// associative = merge(a, merge(b, c)) === merge(merge(a, b), c)

// } | {
//     // hmm so deletes are illegal maybe?
//     type: 'delete',
//     path: Array<string>,

type Path = {
    table: string,
    row: string,
    column: string,
};
// Can I just do Path = Array<string>?
// Would that violate something, to be able to delete something higher up
// Ooh and what do I do it I try to set a row and it's not there? I think I skip it.
// Like, just skip it.
// And we assume -- you can't actually change something if it hasn't been created.
// Now the reason I'm allowed to do this, is I don't have a peer-to-peer network.
// Everything goes through a central hub.
// And so there's no danger of "me hearing about update message X before create message Y"
// Right?
// So I think that means I can have a more lax version of CRDTs. Like, yes messages
// might be applied out of order ... but ... like ... maybe not too much?
//
// I should sit down and think about the case where something gets deleted from under you.
// If I'm processing a `set` for an object that doesn't exist, what do I do?
// I ignore it.
// buuut ok maybe here's the rub. How do I decide "winning" between a "clear the object"
// and a "set the thing", when the set happened after the clear?

// [
//     {type: 'set', path: ['id1', 'types'], value: {code: {language: 'javascript'}}},
//     // between these two, whatever order they're received in, I can know that
//     // "an 'earler' set of a higher thing should still be applied..."
//     // and the second one will be ignored
//     {type: 'set', path: ['id1', 'types'], value: null},
//     {type: 'set', path: ['id1', 'types', 'code', 'language'], value: 'python'},
// ];
// [
//     {type: 'set', path: ['id1', 'types'], value: {code: {language: 'javascript'}}},
//     // andd here's the rub.
//     // the second "set" should win over the first one, but it won't.
//     // So maybe I can't do this.
//     // ok but I can have a "multiset" to cut down on postage
//     {type: 'set', path: ['id1', 'types'], value: {code: {language: 'java'}}},
//     {type: 'set', path: ['id1', 'types', 'code', 'language'], value: 'python'},
// ];

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

/*

// full, in-line representation
const map = {
    x: {value: 1, hlcStamp: 's1'},
    y: {value: 2, hlcStamp: 's2'},
    z: {value: false, hlcStamp: 's3'},
    $created: [1, 0],
}
const deletedMap = {
    x: {value: 5, hlcStamp: 's4'},
    y: {value: 2, hlcStamp: 's2'},
    z: {value: false, hlcStamp: 's3'},
    $created: [1, 1],
}

// a representation that optimizes for direct use in javascript.
// `v` is the "plain js object"
const map = {
    v: {x: 1, y: 2, z: false},
    t: {x: 's1', y: 's2', z: 's3'},
    created: [1, 0], // 1 creation, 0 deletions
}
const deletedMap = {
    // hermmmm I need a timestamp for the "v null" though? idk
    // I guess as long as the created counter hasn't been incremented,
    // we don't need to worry about that?
    v: null,
    t: {x: 's4', y: 's2', z: 's3'},
    pendingAttributes: {x: 5}, // got 
    created: [1, 1], // 1 creation, 1 deletion
}
// I'd want to ~prove that this representation still satisfies all the properties.


*/

// where the "tombstone bit" is concerned, I can remove the object entirely and just
// maintain a separate set of "tombstone ids", which would save on storage space.

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
    | {
          type: 'ot',
          path: Path,
          ops: Array<any>,
      }
    | {
          type: 'insert',
      };
