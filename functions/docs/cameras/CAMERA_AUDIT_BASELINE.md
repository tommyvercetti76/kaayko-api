# Camera Audit Baseline

Baseline source set dated 2026-03-07. Generated from `functions/scripts/camera-audit-report.js`.

## Key Findings

- CANON: 15/15 current baseline bodies covered; missing 0; local-only 16.
- SONY: 20/20 current baseline bodies covered; missing 0; local-only 4.
- Internal consistency: 0 dangling lens-to-camera references and 0 impossible mount pairings.
- Capability depth: body coverage 49.2%, lens coverage 65.5%.

## Current-Body Coverage

### CANON

Official current baseline: 15 bodies
Local Kaayko dataset: 31 bodies
Matched current baseline: 15/15

Missing current bodies
- none

Local-only bodies
- Canon EOS-1D X Mark II
- Canon EOS 5D Mark IV
- Canon EOS 80D
- Canon EOS 1300D (Rebel T6)
- Canon EOS-1D X Mark III
- Canon EOS 6D Mark II
- Canon EOS 77D
- Canon EOS 800D (Rebel T7i)
- Canon EOS 200D (Rebel SL2)
- Canon EOS 2000D (Rebel T7)
- Canon EOS 4000D (Rebel T100)
- Canon EOS 90D
- Canon EOS 250D (Rebel SL3)
- Canon EOS 850D (Rebel T8i)
- Canon EOS R
- Canon EOS Ra

Primary official sources used by this baseline
- Canon EOS R System lineup page: https://www.usa.canon.com/digital-cameras/eos-r-system
- Canon EOS R1 and EOS R5 Mark II launch: https://www.usa.canon.com/newsroom/2024/20240717-camera
- Canon EOS R6 Mark III product page: https://www.usa.canon.com/shop/p/eos-r6-mark-iii
- Canon EOS R50 V launch: https://www.usa.canon.com/newsroom/2025/20250326-camera

### SONY

Official current baseline: 20 bodies
Local Kaayko dataset: 24 bodies
Matched current baseline: 20/20

Missing current bodies
- none

Local-only bodies
- Sony Alpha a6300
- Sony Alpha a6500
- Sony Alpha a9
- Sony Alpha a7R III

Primary official sources used by this baseline
- Sony all interchangeable-lens cameras: https://electronics.sony.com/imaging/interchangeable-lens-cameras/c/all-interchangeable-lens-cameras
- Sony full-frame category: https://electronics.sony.com/imaging/interchangeable-lens-cameras/c/full-frame
- Sony Alpha 9 II product page: https://electronics.sony.com/imaging/interchangeable-lens-cameras/full-frame/p/ilce9m2-b?sku=ilce9m2-b
- Sony Alpha 7C product page: https://electronics.sony.com/imaging/interchangeable-lens-cameras/all-interchangeable-lens-cameras/p/ilce7c-s
- Sony Alpha 7S III product page: https://electronics.sony.com/imaging/interchangeable-lens-cameras/all-interchangeable-lens-cameras/p/ilce7sm3-b
- Sony vlog camera category: https://electronics.sony.com/imaging/compact-cameras/c/vlog-cameras
- Sony ZV-E1 product page: https://electronics.sony.com/imaging/interchangeable-lens-cameras/all-interchangeable-lens-cameras/p/ilczve1-b
- Sony APS-C category: https://electronics.sony.com/imaging/interchangeable-lens-cameras/c/aps-c
- Sony Alpha 6600 product page: https://electronics.sony.com/imaging/interchangeable-lens-cameras/aps-c/p/ilce6600-b

## Data Quality Checks

### CANON

Dangling lens compatibility references: 0
- none

Impossible mount pairings: 0
- none

Duplicate camera names: 0
- none

Duplicate lens names: 0
- none

### SONY

Dangling lens compatibility references: 0
- none

Impossible mount pairings: 0
- none

Duplicate camera names: 0
- none

Duplicate lens names: 0
- none

## Capability Coverage

### Body Schema Coverage

| Category | Populated slots | Coverage |
| --- | ---: | ---: |
| identity | 330/330 | 100.0% |
| sensor | 420/440 | 95.5% |
| shutterAndBurst | 133/330 | 40.3% |
| autofocus | 85/385 | 22.1% |
| stabilization | 117/220 | 53.2% |
| flash | 56/220 | 25.5% |
| storagePowerBuild | 73/275 | 26.5% |
| displayConnectivity | 0/275 | 0.0% |
| video | 0/275 | 0.0% |
| provenance | 275/275 | 100.0% |

### Lens Schema Coverage

| Category | Populated slots | Coverage |
| --- | ---: | ---: |
| identity | 404/505 | 80.0% |
| optical | 505/707 | 71.4% |
| autofocusAndStabilization | 202/404 | 50.0% |
| build | 0/404 | 0.0% |
| compatibility | 303/404 | 75.0% |
| provenance | 505/505 | 100.0% |

### Lowest-Coverage Body Fields

- bluetooth (0.0%)
- electronicFlashSync (0.0%)
- evfResolutionDots (0.0%)
- logProfiles (0.0%)
- maxVideoMode (0.0%)
- openGate (0.0%)
- pcSyncPort (0.0%)
- rawVideo (0.0%)
- rearScreenType (0.0%)
- recordLimitMinutes (0.0%)
- usbPort (0.0%)
- weatherResistanceLevel (0.0%)

### Lowest-Coverage Lens Fields

- diameterMm (0.0%)
- focusBreathingCompSupport (0.0%)
- focusMotor (0.0%)
- lengthMm (0.0%)
- maxMagnification (0.0%)
- minFocusDistanceMeters (0.0%)
- releaseDate (0.0%)
- teleconverterCompatibility (0.0%)
- weatherSealed (0.0%)
- weightGrams (0.0%)

### Body Validation Tiers

- official-lineup: 29
- official-category: 20
- official-record-spec: 6

### Lens Validation Tiers

- official-category: 101

## What This Means

- The current Canon and Sony baseline is now fully covered, so lineup completeness is no longer the primary gap.
- The schema is materially stronger than the initial baseline, but it is still too thin for fully body-specific advice around video ceilings, connectivity, media redundancy, and some flash edge cases.
- Provenance is now present across the catalog, but much of the legacy catalog is still validated at official category-page level rather than record-specific spec-page level.
- The repository now includes generated community-review artifacts, so the human validation phase is operationalized even though it still requires real photographers to complete.

## Next Phases

- Move legacy bodies and lenses from category-level provenance to record-specific spec/support provenance as time allows.
- Expand the body schema to include display, connectivity, video, and flash-behavior fields that are still mostly empty.
- Expand the lens schema to include minimum focus distance, maximum magnification, focus motor, weather sealing, and physical dimensions.
- Execute the review packet with working photographers and log the results before treating genre advice as field-validated.

