# Session Advisor Method

This document describes the logic now emitted under `preset.sessionOptimization`.

## Goal

The advisor is meant to turn a preset from "exposure starting point" into "session setup guide". It does that by combining:

- preset intent from genre, condition, and tags
- hard camera and lens constraints from the catalog
- exposure and handling rules that are stable across Canon and Sony systems

## What The Advisor Covers

Every classic and smart preset can now return guidance in these areas:

- `foundation`: file format, preview profile, color workflow, monitoring tools, lens-correction stance
- `qualityControls`: color accuracy, repeatability, and capture-discipline safeguards
- `composition`: placement guidance, rule-breaking conditions, background control, depth-of-field intent
- `exposure`: mode, shutter, aperture, ISO ceiling, metering, compensation, white balance, bracketing
- `focus`: AF mode, focus area, subject-detection target, drive mode, manual-focus assist
- `stabilization`: available stabilization, handheld shutter floors, tripod guidance
- `shutterAndLighting`: shutter-type choice, flash-sync reminder, lighting strategy, filter/support-gear suggestions
- `lensFit`: focal-range fit for the session, including APS-C equivalent framing where relevant
- `checklist`: pre-session and in-session setup checks
- `scienceNotes`: advanced rationale for non-apprentice modes
- `caveats`: warnings from lens limits, sync limits, low-light instability, and obvious lens-role mismatches

## Science Rules In Use

- Handheld shutter floors start from the reciprocal rule using the longest focal length in play and the body crop factor.
- Stabilization can relax the static-subject shutter floor, but it never replaces shutter speed for moving subjects.
- APS-C crop factor uses `1.6x` for Canon and `1.5x` for Sony.
- Diffraction warnings tighten on APS-C and remain conservative on full-frame.
- White-balance guidance changes by lighting class: daylight, overcast, tungsten/mixed light, astro, and color-critical controlled work.
- Exposure-compensation guidance is scene-aware for snow/beach, silhouettes, high-key, low-key, backlit portraits, and bracket-heavy scenes.
- Shutter-type guidance prefers mechanical or EFCS under LED, fluorescent, and flash conditions, and only leans electronic where silence helps and distortion risk is acceptable.
- Lens-fit warnings trigger when a lens is clearly short for wildlife/sports, not wide enough for architecture/real-estate, weak for portrait focal ranges, or not a true macro tool.
- Composition guidance now treats rule-of-thirds as a default, not a law. Symmetry, reflections, and leading-line frames can justify centered placement.
- Documentation-style sessions now push locked white balance, locked viewpoint, and fixed setup variables more aggressively than expressive sessions.

## Literature Basis

The rule set is now informed by the paper mapping in `RESEARCH_ENGINE_BASIS.md`, including aesthetic-composition studies, documentation standards, and photo-quality work on subject isolation and background simplicity.

## Limits

- The advisor is only as strong as the catalog fields behind it. Missing lens dimensions, focus distance, video limits, and flash-behavior details still limit precision.
- Community validation is not encoded as "crowd opinion". It should happen through the workflow in `CAMERA_VALIDATION_METHOD.md`, using specialty photographers to review real session outputs.
- The output is a strong starting configuration, not an assertion that one setting is universally "correct" for every photographer or light source.
