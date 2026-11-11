/**
 * Injury records for the modality sheet's new exercises, in injury.json's own vocabulary (its
 * loadTags), so a ticked pain removes or cautions them exactly as it does the library. Without
 * these every new exercise would pass every pain: a handstand push-up through a shoulder pain.
 *
 * Rules, not a hand table: each matching rule adds its tags, so a family reads as one line and
 * a new exercise in the sheet picks up its family's tags. The conventions follow the library's
 * own rows: anything hanging or overhead carries NECK_COMP (as Pull-up and Dead hang do), any
 * hand-supported position WR_WB + ELB_WB (Plank, push-ups), and so on.
 */
import type { Exercise } from '../src/types'

type Tag =
  | 'AXIAL' | 'LUM_HINGE' | 'LUM_FLEX' | 'LUM_EXT' | 'TRUNK_ROT' | 'IAP' | 'NECK_DIR' | 'NECK_COMP'
  | 'OVERHEAD' | 'SH_IMPINGE' | 'PEC_STRETCH' | 'SH_LOAD' | 'ELB_EXT' | 'ELB_FLEX' | 'ELB_WB' | 'WR_WB'
  | 'WR_DIR' | 'GRIP' | 'HIP_DEEPFLEX' | 'HIP_ABD' | 'ADD_STRETCH' | 'HF_LOAD' | 'KNEE_LOAD' | 'KNEE_DEEP'
  | 'KNEE_OPEN' | 'HAM_STRETCH' | 'ANK_PLANTAR' | 'ANK_DORSI' | 'IMPACT'

const HANG: Tag[] = ['GRIP', 'ELB_FLEX', 'SH_LOAD', 'OVERHEAD', 'NECK_COMP']
const HAND_SUPPORT: Tag[] = ['WR_WB', 'ELB_WB', 'SH_LOAD']
const PRESS: Tag[] = ['ELB_EXT', 'ELB_WB', 'SH_LOAD', 'WR_WB']
const INVERTED: Tag[] = ['OVERHEAD', 'WR_WB', 'ELB_WB', 'SH_LOAD', 'NECK_COMP']
const SQUAT_DEEP: Tag[] = ['KNEE_LOAD', 'KNEE_DEEP', 'HIP_DEEPFLEX', 'ANK_DORSI']
const BAR_HINGE: Tag[] = ['LUM_HINGE', 'HAM_STRETCH', 'GRIP', 'AXIAL', 'IAP']
const FRONT_RACK: Tag[] = ['AXIAL', 'NECK_COMP', 'WR_WB', 'IAP']
const OVERHEAD_BAR: Tag[] = ['OVERHEAD', 'SH_LOAD', 'ELB_EXT', 'NECK_COMP', 'IAP']
const CURL_UP: Tag[] = ['LUM_FLEX', 'NECK_DIR']
const LEG_LIFT: Tag[] = ['HF_LOAD', 'LUM_FLEX']
const ROLL_OVER: Tag[] = ['LUM_FLEX', 'NECK_COMP', 'HF_LOAD']

const RULES: [RegExp, Tag[]][] = [
  // ---- calisthenics: pushing and supporting ----
  [/push-up|burpee/i, PRESS],
  [/^wall push-up$/i, ['ELB_EXT', 'SH_LOAD', 'WR_WB']],
  [/archer push|one-arm push|ring push|pseudo planche/i, ['PEC_STRETCH']],
  [/pike push|handstand push|wall walk|handstand walk|handstand hold|freestanding handstand|handstand shoulder|wall pike|plank walk/i, INVERTED],
  [/pike push|handstand push/i, ['ELB_EXT']],
  [/kipping handstand/i, ['LUM_EXT', 'IMPACT']],
  [/planche|frog stand|elbow lever/i, ['WR_WB', 'ELB_WB', 'SH_LOAD', 'IAP']],
  // The planche family loads the front of the shoulder at full stretch (the anterior capsule): a shoulder
  // pain removes it, as it does a deep dip.
  [/planche/i, ['ELB_FLEX', 'PEC_STRETCH']],
  [/support hold|ring dip|korean dip/i, ['ELB_WB', 'SH_LOAD', 'ELB_EXT']],
  [/ring dip|korean dip/i, ['PEC_STRETCH']],
  [/l-sit|v-sit/i, [...HAND_SUPPORT, 'HF_LOAD', 'IAP']],
  // ---- calisthenics: hanging and pulling ----
  [/pull-up|muscle-up|transition drill|rope climb|front lever|back lever|skin the cat|human flag|flag hold|toes-to-bar|knees-to-elbow|hanging windshield|pull-over to bar/i, HANG],
  [/kipping pull|butterfly pull|muscle-up|transition drill/i, ['SH_IMPINGE', 'LUM_EXT']],
  [/muscle-up|transition drill/i, ['ELB_EXT', 'PEC_STRETCH']],
  // A back lever is the low back's extension skill under the whole body's weight: heavy bracing, so a sore
  // low back removes it (IAP), not just cautions it.
  [/back lever|skin the cat/i, ['PEC_STRETCH', 'LUM_EXT', 'IAP']],
  [/front lever|human flag|flag hold/i, ['IAP']],
  [/human flag|flag hold/i, ['TRUNK_ROT']],
  [/inverted row|ring row|lever row/i, ['GRIP', 'ELB_FLEX', 'SH_LOAD']],
  [/toes-to-bar|knees-to-elbow|hanging windshield|pull-over to bar/i, LEG_LIFT],
  [/windshield/i, ['TRUNK_ROT']],
  [/lying windshield/i, ['HF_LOAD']],
  // ---- calisthenics: legs ----
  [/shrimp/i, SQUAT_DEEP],
  [/box pistol/i, ['KNEE_LOAD', 'ANK_DORSI']],
  // ---- CrossFit: barbell ----
  [/^(muscle|power|squat|hang power) (snatch|clean)|^clean (pull|and jerk)|snatch-grip deadlift|snatch high pull|sandbag clean/i, BAR_HINGE],
  [/^(muscle|power|squat|hang power) snatch|snatch balance|overhead squat|jerk|thruster|overhead walking lunge/i, OVERHEAD_BAR],
  [/squat snatch|squat clean|overhead squat|snatch balance|clean and jerk/i, SQUAT_DEEP],
  [/clean(?! pull)|front rack|thruster|jerk/i, FRONT_RACK],
  [/power clean|hang power|power snatch|muscle snatch|muscle clean|high pull|push jerk/i, ['KNEE_LOAD']],
  [/split jerk|walking lunge/i, ['KNEE_LOAD', 'HIP_DEEPFLEX']],
  [/thruster|wall ball/i, ['KNEE_LOAD', 'HIP_DEEPFLEX', 'OVERHEAD', 'SH_LOAD']],
  [/dumbbell snatch|devil press/i, ['LUM_HINGE', 'OVERHEAD', 'SH_LOAD', 'GRIP', 'IAP']],
  [/devil press/i, PRESS],
  [/kettlebell swing/i, ['IAP', 'IMPACT', 'LUM_HINGE', 'GRIP', 'OVERHEAD', 'SH_LOAD']],
  [/sandbag|d-ball/i, ['LUM_HINGE', 'LUM_FLEX', 'IAP', 'GRIP', 'KNEE_LOAD']],
  [/ghd sit-up/i, ['LUM_FLEX', 'LUM_EXT', 'HF_LOAD', 'IAP']],
  // ---- CrossFit: engine and jumping ----
  [/box jump|burpee box|double-under|shuttle run|jumping muscle/i, ['IMPACT', 'ANK_PLANTAR']],
  [/box jump|burpee box/i, ['KNEE_LOAD']],
  [/burpee/i, ['IMPACT', 'KNEE_LOAD']],
  [/sled push/i, ['KNEE_LOAD', 'ANK_DORSI', 'IAP', 'SH_LOAD']],
  [/sled drag/i, ['KNEE_LOAD', 'GRIP', 'LUM_HINGE']],
  [/air bike/i, ['KNEE_LOAD']],
  [/rowing machine/i, ['LUM_FLEX', 'GRIP', 'KNEE_LOAD']],
  [/ski erg/i, ['OVERHEAD', 'SH_LOAD', 'LUM_FLEX']],
  [/ball slam/i, ['OVERHEAD', 'SH_LOAD', 'LUM_FLEX', 'IAP']],
  // ---- Pilates mat: curl-ups, leg lifts, rolling and inversions ----
  // The reformer's rounded-spine moves flex the lumbar spine like the mat's do.
  [/stomach massage: round|knee stretch: round|^elephant$|rowing: from the|short spine massage|^coordination$/i, ['LUM_FLEX']],
  // Rolling inversions put the neck under the body's weight: neck pain removes them (NECK_DIR), as it
  // does any direct neck load.
  [/roll over|jack knife|boomerang|control balance|corkscrew|short spine massage|long spine massage|semi-circle/i, ['NECK_DIR']],
  [/^the hundred$|hundred on the reformer|chest lift|single leg stretch|double leg stretch|straight leg stretch|criss-cross|neck pull|^teaser$|teaser on the box|^coordination$|backstroke/i, CURL_UP],
  [/^the hundred$|hundred on the reformer|double leg stretch|straight leg stretch|^scissors$|^bicycle$|^teaser$|teaser on the box|^coordination$|backstroke|single leg circles|leg circles in straps|hip circles/i, ['HF_LOAD']],
  [/roll up|rolling like a ball|open leg rocker|^seal$|short box: round back|standing roll down|spine stretch forward|^saw$/i, ['LUM_FLEX']],
  [/roll over|jack knife|corkscrew|boomerang|control balance|short spine massage|long spine massage|^scissors$|^bicycle$/i, ROLL_OVER],
  [/criss-cross|spine twist|^saw$|corkscrew|hip circles|short box: twist|stomach massage: twist|snake and twist|chest lift with rotation/i, ['TRUNK_ROT']],
  // ---- Pilates: extension ----
  [/^swan|swan dive|single leg kick|double leg kick|swimming|breaststroke|pulling straps|t-pull|short box: flat back|down stretch|^swan on the long box$/i, ['LUM_EXT']],
  [/^swan$/i, ['WR_WB', 'ELB_EXT']],
  [/double leg kick/i, ['PEC_STRETCH']],
  [/hip circles/i, ['LUM_FLEX', 'WR_WB']],
  [/side to side/i, ['LUM_FLEX']],
  [/pulling straps|t-pull/i, ['SH_LOAD']],
  [/shoulder bridge|pelvic lift on the reformer|semi-circle/i, ['LUM_EXT', 'NECK_COMP']],
  // ---- Pilates: hand-supported ----
  [/leg pull front|leg pull back|pilates push-up|kneeling side kick|mermaid side bend|long stretch|up stretch|down stretch|elephant|knee stretch|arabesque|^star$|control front|snake and twist/i, HAND_SUPPORT],
  [/up stretch|arabesque|^star$|control front|snake and twist/i, ['IAP']],
  [/leg pull back/i, ['PEC_STRETCH']],
  [/knee stretch|kneeling side kick|stomach massage|kneeling arm series/i, ['KNEE_LOAD']],
  // ---- Pilates: hips and legs ----
  [/side kick|kneeling side kick|openings in straps|^star$/i, ['HIP_ABD']],
  [/side splits|frog in straps|openings in straps/i, ['ADD_STRETCH']],
  [/front splits|elephant|short box: tree|spine stretch forward/i, ['HAM_STRETCH']],
  [/front splits/i, ['HIP_DEEPFLEX']],
  [/^footwork|jumpboard|running on the reformer|stomach massage|side splits/i, ['KNEE_LOAD']],
  [/footwork: toes|tendon stretch|running on the reformer|jumpboard/i, ['ANK_PLANTAR']],
  [/jumpboard/i, ['IMPACT']],
  // ---- Pilates: arm work ----
  [/rowing: |shave|hug a tree|arm series/i, ['SH_LOAD']],
  [/rowing: into|rowing: 90/i, ['ELB_FLEX']],
  [/rowing: from|shave|kneeling arm series/i, ['OVERHEAD']],
  [/shave/i, ['ELB_EXT']],
  [/hug a tree/i, ['PEC_STRETCH']],
]

/** Breathing, rest position and the like load nothing: they are listed so they are deliberate. */
const NOTHING = /lateral breathing|rest position|pelvic curl|supine spine twist|side kick small circles|mermaid on the reformer|^footwork: heels$|^footwork: arches$|pelvic lift on the reformer/i

/**
 * "One-sided" lets a pain keep the move on the pain-free side (injury.ts SIDE_ONLY), so it is only for
 * moves that really load one limb: a pistol, a one-arm push-up, a side kick. An archer pull-up, a flag,
 * a one-leg L-sit or lever, a split jerk, a loaded lunge or a dumbbell snatch still loads both arms,
 * both wrists or the spine, so they are not.
 */
const ONE_SIDED = /^one-arm|^assisted one-arm|one-arm inverted|pistol|shrimp|side kick|single leg circles|single leg kick|single leg stretch|kneeling side kick|front splits|arabesque/i

export function injuryRecord(ex: Exercise, keyOfCode: Map<string, string>) {
  const tags = new Set<Tag>()
  for (const [re, add] of RULES) if (re.test(ex.name)) for (const t of add) tags.add(t)
  return {
    id: ex.id,
    name: ex.name,
    key: keyOfCode.get(ex.code) ?? `${ex.group} > ${ex.sub}`,
    loadTags: [...tags].sort(),
    unilateral: ONE_SIDED.test(ex.name),
    corrective: false,
    /** set only when no rule matched and the exercise is not one that loads nothing */
    ...(tags.size === 0 && !NOTHING.test(ex.name) && { unreviewed: true }),
  }
}
