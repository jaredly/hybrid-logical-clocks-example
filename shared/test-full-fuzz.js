// @flow
require('@babel/register')({ presets: ['@babel/preset-flow'] });
const {
    deltas,
    create,
    createDeepMap,
    value,
    applyDelta,
    showDelta,
} = require('./plain-always-wins.js');

const makeTick = () => {
    let id = 1;
    return () => {
        return (id++).toString().padStart(1, '0');
    };
};

const allKeyPaths = data => {
    return [].concat(
        ...Object.keys(data).map(k => {
            if (typeof data[k] === 'object') {
                return [{ path: [k], value: data[k] }].concat(
                    allKeyPaths(data[k]).map(({ path, value }) => ({
                        path: [k].concat(path),
                        value,
                    })),
                );
            }
            return [{ path: [k], value: data[k] }];
        }),
    );
};

const randomReplacement = data => {
    if (data == null) {
        return data;
    }
    switch (typeof data) {
        case 'boolean':
            return Math.random() > 0.5;
        case 'number':
            return Math.random();
        case 'string':
            return Math.random().toString(36);
        case 'object':
            const res = {};
            Object.keys(data).forEach(k => {
                res[k] = randomReplacement(data[k]);
            });
            return res;
    }
};

const largeDataStructure = {
    name: 'Hybria Dato',
    age: 5,
    here: false,
    address: {
        street: 'Place time',
        number: 34,
    },
    limbs: {
        arms: 6,
        legs: {
            left: {
                length: 34,
            },
            right: {
                width: 7,
            },
        },
    },
};

const exampleData = {
    name: 'Top level',
    nested: {
        level: 1,
        inner: {
            at: 'level 2',
        },
    },
};

const randomCrdt = (value, hlcStamp) => {
    const rep = randomReplacement(value);
    if (rep && typeof rep === 'object') {
        return createDeepMap(rep, hlcStamp);
    }
    return create(rep, hlcStamp);
};

/*
1 2
2 1

1 2 3
2 1 3
1 3 2
3 1 2
2 3 1
3 2 1

1 2
1 3
2 3

1 2
1 4
2 4

1 3
1 4
3 4

2 4
3 4
2 3

2 1 == 1 2 A
1 3 == 3 1 B
2 3 == 3 2 C
2 1 3 == 3 1 2 == 2 3 1

2 1 == 1 2 A
1 4 == 4 1 D
2 4 == 4 2 E
2 1 4 == 1 4 2 == 2 4 1

4 1 == 1 4 D
1 3 == 3 1 B
4 3 == 3 4 F
4 1 3 == 1 3 4 == 4 3 1

2 4 == 4 2 E
4 3 == 3 4 F
2 3 == 3 2 C
2 4 3 == 4 3 2 == 2 3 4

2 1 3 4 == 2 1 4 3 == 4 1 3 2 == 2 4 3 1

2 1 3 4
1 2 3 4
1 3 2 4
3 1 2 4
2 3 1 4
3 2 1 4

2 1 4 3
1 2 4 3
1 4 2 3
4 1 2 3
2 4 1 3
4 2 1 3

4 1 3 2
1 4 3 2
1 3 4 2
3 1 4 2
4 3 1 2
3 4 1 2

2 4 3 1
4 2 3 1
4 3 2 1
3 4 2 1
2 3 4 1
3 2 4 1

1 2 3
1 3 2
2 1 3
2 3 1
3 1 2
3 2 1

*/

const { check, permute } = require('./permute');

const testPermutations = (base, deltas) => {
    return check(
        base,
        deltas,
        applyDelta,
        (a, b) => JSON.stringify(value(a)) === JSON.stringify(value(b)),
    );
};

const get = (obj, path) => {
    for (let key of path) {
        obj = obj[key];
    }
    return obj;
};

const generateDeltas = value => {
    const keyPaths = allKeyPaths(value);
    const allDeltas = [];

    keyPaths.forEach(path => {
        const tick = makeTick();
        const isObject = path.value && typeof path.value === 'object';
        const makeDeltas = ticks => {
            const res = [
                deltas.set(path.path, randomCrdt(path.value, ticks[0])),
                deltas.removeAt(path.path, ticks[1]),
            ];
            for (let i = 1; i < path.path.length; i++) {
                const sub = path.path.slice(0, -i);
                res.push(
                    deltas.removeAt(sub, ticks[i * 2]),
                    deltas.set(
                        sub,
                        randomCrdt(get(value, sub), ticks[i * 2 + 1]),
                    ),
                );
            }
            if (isObject) {
                res.push(
                    deltas.set(path.path, create(5, ticks[ticks.length - 2])),
                    deltas.set(path.path, create(15, ticks[ticks.length - 1])),
                );
            }
            return res;
        };
        const ticks = [];
        for (let i = 0; i < path.path.length * 2; i++) {
            ticks.push(tick());
        }
        if (isObject) {
            ticks.push(tick());
            ticks.push(tick());
        }
        const theseDeltas = [];
        permute(ticks).forEach(times => {
            theseDeltas.push(makeDeltas(times));
        });
        allDeltas.push({ path, deltas: theseDeltas });
        // console.log(ticks.length, theseDeltas.length);
        // console.log(theseDeltas[0]);
    });
    // console.log(allDeltas.length);
    return allDeltas;
};

const allDeltas = generateDeltas(exampleData);
const crdt = createDeepMap(exampleData, '0');
allDeltas.forEach(({ path, deltas }) => {
    console.log(path.path);
    deltas.forEach(ops => {
        const failures = testPermutations(crdt, ops);
        if (failures.length) {
            failures.forEach(({ key, conflicts }) => {
                console.log('Conflict:', key);
                conflicts.forEach(result => {
                    console.log(result.is.map(k => k.join(':')).join(' & '));
                    console.log(
                        result.is[0]
                            .map(i => ops[i])
                            .map(showDelta)
                            .join('\n'),
                    );
                    console.log(JSON.stringify(value(result.current)));
                });
                console.log();
            });
            // console.log(JSON.stringify(failures, null, 2));
            console.log('bail');
            process.exit(1);
        } else {
            process.stdout.write('.');
        }
    });
    // theseDeltas.forEach()
});
