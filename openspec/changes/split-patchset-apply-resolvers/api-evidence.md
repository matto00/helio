# Public-API evidence (HEL-1479, D6b / C5)

Generated against `BASE=55b53be4a` (`git merge-base HEAD origin/main`, the HEL-1480 merge; HEAD merged it in `46c0ba9b4`).
The earlier `6d298d5f8` set is kept only as `move-check/superseded-6d298d5f8/`.

`javap -public` of `com.helio.services.patchsets.PatchSetApplyResolvers` and `PatchSetApplyResolvers$` from the sbt class
output dir (`backend/target/out/jvm/scala-2.13.15/helio-backend/classes`), captured with `move-check/javap.sh`.
BASE was compiled in a scratch detached worktree at `55b53be4a`
(`.concertino/runs/HEL-1479/evidence/hel1479-base-wt`, clean, `sbt Test/compile` exit 0, `evidence/compile-base.log`);
AFTER is this branch's compile (`evidence/compile-after2.log`, exit 0).

**Normalisation (declared before the run):** drop every line matching `\$anonfun\$|\$deserializeLambda\$|\$\$` and nothing else
(Scala 2.13 lambda bodies are public static `$anonfun$<method>$<N>` methods that leave the class when their enclosing method
moves; `$$`-mangled accessors).

| | raw lines | dropped by filter | filtered lines |
|---|---|---|---|
| BASE (`javap-base.raw`/`.filtered`) | 78 | 66 | 12 |
| AFTER (`javap-after.raw`/`.filtered`) | 18 | 6 | 12 |

`diff javap-base.filtered javap-after.filtered`: **empty** (exit 0). Filtered content: the `resolveAll` static forwarder on the
mirror class, and `MODULE$`, the static initializer and `resolveAll` on `PatchSetApplyResolvers$`. The 60-line difference in dropped
lines is lambda bodies (`$anonfun$`) of the moved resolvers plus their `$deserializeLambda$`; nothing public was added or removed.

**Red run** (`move-check/javap-red-run.txt`; temporary, source restored afterwards, compile log `evidence/javap-red-compile2.log`,
exit 0): adding a trailing defaulted parameter `redProbe: Boolean = false` to `resolveAll`, which still compiled, makes the
filtered diff NON-empty (the signature gains `boolean`, and `resolveAll$default$4()` appears on both classes; diff exit 1).
