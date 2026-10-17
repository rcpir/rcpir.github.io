// Noise support S: a uniformly random subset of [0, m) of size s ("fixed-weight" noise).
/** Uniform integer in [0, m), 1 <= m <= 2^32. */
function randomBelow(m) {
    // Values >= limit are rejected so that x % m has no bias (limit is a multiple of m).
    const limit = 2 ** 32 - (2 ** 32 % m);
    const x = new Uint32Array(1);
    do {
        crypto.getRandomValues(x);
    } while (x[0] >= limit);
    return x[0] % m;
}
/** Draws uniform indices until s distinct ones are collected; returned sorted. */
export function sampleSubset(m, s) {
    if (s > m)
        throw new RangeError(`cannot pick ${s} distinct indices from ${m}`);
    const S = new Set();
    while (S.size < s)
        S.add(randomBelow(m));
    return [...S].sort((a, b) => a - b);
}
//# sourceMappingURL=sample.js.map