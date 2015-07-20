all: whammy.js whammy.min.js

whammy.js: whammy.ts
	tsc -m commonjs -t ES5 whammy.ts

%.min.js: %.js
	closure-compiler --language_in ECMASCRIPT5 --warning_level QUIET $< >$@
