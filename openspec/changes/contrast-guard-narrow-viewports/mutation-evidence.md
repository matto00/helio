# Mutation evidence (HEL-1649 AC)

Each mutation was applied to the tree, the FULL narrow spec run (20 cells, both width files' cells together, 2 workers),
then reverted (`git checkout`); nothing mutated is committed. Unmutated: all 20 green
(`evidence/03-green-narrow-full-ratios.log.txt`, and per file `evidence/08-final-green-*.log.txt`), plus the three existing
1440 parts green (`evidence/07-existing-*.log.txt`: 8, 8 and 4 passed). The narrow spec was run as one 20-cell file for
M1/M2 and later split into two part files by width (identical cells); no filtering by `--grep` was used.

- **M1** (delete the two `.spine-card .source-sample-label .ui-icon-btn:hover:not(:disabled)` rules in
  `PipelineSpine.css`, HEL-1628's pre-fix ghost hover): `evidence/04-M1-sample-refresh-hover-removed.log.txt`, 2 failed
  and 18 passed: `[dark] /pipelines/:id@768` and `/pipelines/:id@390` ::
  `button "" aria="Refresh sample of HEL-866 Guard Source" [ui-icon-btn] (hover) ratio=1.0301` (light is unchanged, as
  predicted: the pre-fix and fixed colour are the same token there). Each narrow `pipeline-detail` cell also logs
  `[HEL-1649 guard] "Refresh sample of HEL-866 Guard Source" probed at <w>px`.
  - Also run against the existing 1440 `pipeline-detail` cell (`evidence/05-M1-at-1440-pipeline-detail.log.txt`): it also
    goes red there (ratio 1.0301). So on today's tree the viewport was not the gap for this particular rule; the HEL-1628
    miss came from the button not being stamped (absent until access resolves, disabled while the sample loads) at stamp
    time. The narrow cells now gate on the button being visible AND enabled before stamping, and the 1440 cell is
    unchanged by this ticket (its populations and titles are untouched).
- **M2** (flatten both `.app-command-bar__logo` hover rules to `--app-surface`, the command bar backdrop):
  `evidence/06-M2-logo-hover-flattened.log.txt`, 16 failed and 4 passed. Red at 768 and 390 in both themes, naming
  `a "Helio" aria="Helio home" [app-command-bar__logo] (hover) ratio=1`; the 4 passing cells are the 1100px ones. Proves a
  phone-chrome view is really probed (the 1440 route cells only credit chrome for the partition check).
