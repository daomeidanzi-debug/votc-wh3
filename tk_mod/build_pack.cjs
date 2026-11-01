/*
 * Builds votc_3k.pack (Total War: THREE KINGDOMS mod pack) from the files under tk_mod/script/.
 * Same PFH5 format as Warhammer III, see wh3_mod/build_pack.cjs.
 *
 *   node tk_mod/build_pack.cjs [output.pack]
 */
const path = require('path');
const { build } = require('../wh3_mod/build_pack.cjs');

build(process.argv[2] || path.join(__dirname, 'votc_3k.pack'), __dirname, 'script\\campaign\\mod\\votc_3k_license.txt');
