# BrittVideo Desk — User Guide

`BrittVideo_Desk_User_Guide.pdf` is the step-by-step guide for a brand-new user (owner test edition, v3.0.1).

To rebuild after app changes:
1. Fresh database + `ALLOW_PRIVATE_FETCH=true` app on :3000 and the sample dental site on 127.0.0.1:4000.
2. `SHOTS=<dir> node e2e/guide-shots.js` takes every screenshot on the empty copy.
3. Compress the shots into `img/` (JPEG, 1600 px wide), then `python3 build.py && node topdf.js`.

Owner corrections from testing go into `build.py` (the text) or the app itself, then rebuild.
