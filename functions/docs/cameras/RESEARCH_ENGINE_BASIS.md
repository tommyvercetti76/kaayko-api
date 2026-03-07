# Research Basis For Camera Advice

This note records the literature pass used to strengthen `preset.sessionOptimization`.

## Verified Sources Used

- "The choices hidden in photography" — verified as a 2024 Journal of Vision article, not 2022:
  [PMC10863113](https://pmc.ncbi.nlm.nih.gov/articles/PMC10863113/)
  Engine impact: the advisor now treats processing, viewpoint, focal length, and tone decisions as explicit capture choices instead of invisible defaults.

- "When might we break the rules? A statistical analysis of aesthetics in photographs" (2022):
  [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0276965)
  Engine impact: composition advice no longer assumes rule-of-thirds is always best. Symmetry, reflections, and strong leading lines can justify centered placement.

- "Camera settings and biome influence the accuracy of citizen science approaches to camera trap image classification" (2020):
  [PMC8041344](https://pmc.ncbi.nlm.nih.gov/articles/PMC8041344/)
  Engine impact: the advisor now pushes full-resolution master capture more aggressively and adds remote-wildlife notes about in-situ testing and burst behavior.

- "The Design of High-Level Features for Photo Quality Assessment" (2010):
  [Microsoft Research](https://www.microsoft.com/en-us/research/publication/the-design-of-high-level-features-for-photo-quality-assessment/)
  Engine impact: composition and background guidance now explicitly reward subject isolation, simpler backgrounds, lower color clutter, and intentional blur.

- "A Proposal for Updated Standards of Photographic Documentation" (2017):
  [PMC5585426](https://pmc.ncbi.nlm.nih.gov/articles/PMC5585426/)
  Engine impact: documentation and commercial-style sessions now emphasize fixed focal length, perspective, white balance, exposure, and background consistency.

- "The Art and Science of Photography in Hand Surgery" (2014):
  [PMC5991050](https://pmc.ncbi.nlm.nih.gov/articles/PMC5991050/)
  Engine impact: repeatability and framing discipline for comparative/documentary work are now explicit rather than implied.

## Findings Turned Into Engine Rules

- Hidden capture choices:
  Cameras do not passively record a scene. Exposure, focal length, position, processing, and tone mapping alter interpretation. The advisor now includes `foundation.processingDiscipline` and `qualityControls.hiddenChoiceAwareness`.

- Rule-breaking in composition:
  Centered compositions are now recommended when the scene is driven by symmetry, reflections, or vanishing-point structure. The advisor now includes `composition.placement` and `composition.ruleBreaking`.

- Background simplicity and blur:
  Subject isolation, lower background clutter, and controlled blur now appear as first-class composition advice, especially for portrait, product, food, and macro work.

- Repeatability for documentation:
  Product, architecture, real-estate, and similar sessions now get fixed-setup advice under `qualityControls.repeatability`, plus new checklist items for locked position, focal length, background, and white balance.

- Color fidelity:
  Color-critical sessions now explicitly recommend RAW, locked white balance, and a gray/color target when the lighting setup changes.

- Resolution discipline:
  Wildlife, macro, astro, and documentation-style sessions now default to full-resolution master capture because later cropping/downsampling is safer than early detail loss.

## Citations Not Treated As Verified Inputs

- I did not find an exact primary-source match for the listed Nature citation "Exploring the limits of color accuracy in technical photography" during this pass, so I did not use that exact citation as a code-level source.
- I also did not use the PRNU saturation thesis as a major engine input because it is more directly about forensic sensor-noise analysis than practical session setup guidance.

## What Still Needs Human Validation

- Specialty-photographer review by genre remains necessary. The literature improves the rule base, but it does not replace working-shooter validation.
- Product, real-estate, wildlife, and documentary branches are the best next candidates for real-world test images and reviewer scoring.
