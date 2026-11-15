/** Source-bound registrations from the actual Spine 4.1.23 runtime audit.
 * Static NPCs share their exact source images. No dialogue/engine policy lives here.
 * Placement is provisional on the existing preview plane; reference anchors
 * are measured once. See docs/ALL_CHARACTERS_INTEGRATION.md. */
export const additionalSchoolPortraitData = [
  {
    "slug": "cartethyia",
    "name": "Cartethyia",
    "talkerId": 700001,
    "stem": "SolarSchool_Katixiya",
    "version": "4.1.23",
    "metadataFile": "cartethyia.animation-metadata.json",
    "textureFile": "SolarSchool_Katixiya.webp",
    "dimensions": [
      4096,
      4096
    ],
    "skeletonBytes": 250030,
    "defaultExpression": 700027,
    "sourceAtlas": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Katixiya/SolarSchool_Katixiya.SolarSchool_Katixiya-atlas",
    "sourceSkeleton": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Katixiya/SolarSchool_Katixiya.SolarSchool_Katixiya-data",
    "calibration": {
      "provisional": true,
      "referenceExpression": 700027,
      "anchorX": -320.5000381457098,
      "anchorY": -3183.990234374998,
      "referenceHeight": 6725.487152099607,
      "heightFraction": 0.84
    },
    "poseDurations": {
      "dongzuo1_zhengchang_zhengyan": 0.6666666865348816,
      "dongzuo1_kaixin_zhengyan": 0.6666666865348816,
      "dongzuo2_gandong_zhengyan": 0.6666666865348816,
      "dongzuo2_sikao_zhengyan": 0.6666666865348816,
      "dongzuo2_yansu_zhengyan": 0.6666666865348816,
      "dongzuo2_kunao_zhengyan": 0.6666666865348816,
      "dongzuo2_kaixin_zhengyan": 0.6666666865348816
    },
    "loopAnimations": [
      "dongzuo1_zhengchang_zhengyan",
      "dongzuo1_kaixin_zhengyan",
      "dongzuo2_gandong_zhengyan",
      "dongzuo2_sikao_zhengyan",
      "dongzuo2_yansu_zhengyan",
      "dongzuo2_kunao_zhengyan",
      "dongzuo2_kaixin_zhengyan"
    ],
    "verifiedBlinks": [
      "dongzuo1_zhengchang_zhayan",
      "dongzuo1_kaixin_zhayan",
      "dongzuo2_gandong_zhayan",
      "dongzuo2_sikao_zhayan",
      "dongzuo2_yansu_zhayan",
      "dongzuo2_kunao_zhayan",
      "dongzuo2_kaixin_zhayan"
    ],
    "unsupportedExpressionReasons": {},
    "animationAliases": {}
  },
  {
    "slug": "shorekeeper",
    "name": "Shorekeeper",
    "talkerId": 700003,
    "stem": "SolarSchool_Shouanren",
    "version": "4.1.23",
    "metadataFile": "shorekeeper.animation-metadata.json",
    "textureFile": "SolarSchool_Shouanren.webp",
    "dimensions": [
      4096,
      2048
    ],
    "skeletonBytes": 135689,
    "defaultExpression": 700092,
    "sourceAtlas": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Shouanren/SolarSchool_Shouanren.SolarSchool_Shouanren-atlas",
    "sourceSkeleton": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Shouanren/SolarSchool_Shouanren.SolarSchool_Shouanren-data",
    "calibration": {
      "provisional": true,
      "referenceExpression": 700092,
      "anchorX": -5.489505370863981,
      "anchorY": -2470.3081054687495,
      "referenceHeight": 5275.133789062497,
      "heightFraction": 0.84
    },
    "poseDurations": {
      "dongzuo1_haixiu_zhengyan": 1.3333333730697632,
      "dongzuo1_yansu_zhengyan": 1.3333333730697632,
      "dongzuo1_yihuo_zhengyan": 1.3333333730697632,
      "dongzuo1_pingjing_zhengyan": 1.3333333730697632,
      "dongzuo1_weixiao_zhengyan": 1.3333333730697632,
      "dongzuo3_zhengchang_zhengyan": 1.3333333730697632
    },
    "loopAnimations": [
      "dongzuo1_haixiu_zhengyan",
      "dongzuo1_yansu_zhengyan",
      "dongzuo1_yihuo_zhengyan",
      "dongzuo1_pingjing_zhengyan",
      "dongzuo1_weixiao_zhengyan",
      "dongzuo3_zhengchang_zhengyan"
    ],
    "verifiedBlinks": [
      "dongzuo1_haixiu_zhayan",
      "dongzuo1_yansu_zhayan",
      "dongzuo1_yihuo_zhayan",
      "dongzuo1_pingjing_zhayan",
      "dongzuo1_weixiao_zhayan",
      "dongzuo3_zhengchang_zhayan"
    ],
    "unsupportedExpressionReasons": {
      "700008": "Source expression 700008 references absent skeleton clips: dongzuo1_kaixin_zhayan, dongzuo1_kaixin_zhengyan."
    },
    "animationAliases": {}
  },
  {
    "slug": "phoebe",
    "name": "Phoebe",
    "talkerId": 700004,
    "stem": "SolarSchool_Feibi",
    "version": "4.1.23",
    "metadataFile": "phoebe.animation-metadata.json",
    "textureFile": "SolarSchool_Feibi.webp",
    "dimensions": [
      4096,
      4096
    ],
    "skeletonBytes": 114447,
    "defaultExpression": 700110,
    "sourceAtlas": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Feibi/SolarSchool_Feibi.SolarSchool_Feibi-atlas",
    "sourceSkeleton": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Feibi/SolarSchool_Feibi.SolarSchool_Feibi-data",
    "calibration": {
      "provisional": true,
      "referenceExpression": 700110,
      "anchorX": 15.000771347298723,
      "anchorY": -3224.499999999998,
      "referenceHeight": 5706.999999999997,
      "heightFraction": 0.84
    },
    "poseDurations": {
      "dongzuo1_kaixin_zhengyan": 1.3333333730697632,
      "dongzuo1_zhengchang_zhengyan": 1.3333333730697632,
      "dongzuo1_liuhan_zhengyan": 1.3333333730697632,
      "dongzuo1_shengqi_zhengyan": 1.3333333730697632,
      "dongzuo1_nanguo_zhengyan": 1.3333333730697632,
      "dongzuo1_haixiu_zhengyan": 1.3333333730697632
    },
    "loopAnimations": [
      "dongzuo1_kaixin_zhengyan",
      "dongzuo1_zhengchang_zhengyan",
      "dongzuo1_liuhan_zhengyan",
      "dongzuo1_shengqi_zhengyan",
      "dongzuo1_nanguo_zhengyan",
      "dongzuo1_haixiu_zhengyan"
    ],
    "verifiedBlinks": [
      "dongzuo1_kaixin_zhayan",
      "dongzuo1_zhengchang_zhayan",
      "dongzuo1_liuhan_zhayan",
      "dongzuo1_shengqi_zhayan",
      "dongzuo1_nanguo_zhayan",
      "dongzuo1_haixiu_zhayan"
    ],
    "unsupportedExpressionReasons": {},
    "animationAliases": {}
  },
  {
    "slug": "buling",
    "name": "Buling",
    "talkerId": 700006,
    "stem": "SolarSchool_Buling",
    "version": "4.1.23",
    "metadataFile": "buling.animation-metadata.json",
    "textureFile": "SolarSchool_Buling.webp",
    "dimensions": [
      4096,
      4096
    ],
    "skeletonBytes": 57670,
    "defaultExpression": 700073,
    "sourceAtlas": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Buling/SolarSchool_Buling.SolarSchool_Buling-atlas",
    "sourceSkeleton": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Buling/SolarSchool_Buling.SolarSchool_Buling-data",
    "calibration": {
      "provisional": true,
      "referenceExpression": 700073,
      "anchorX": 29.30060773835544,
      "anchorY": -2876.885253906249,
      "referenceHeight": 5782.885742187497,
      "heightFraction": 0.84
    },
    "poseDurations": {
      "dongzuo1_zhengchang_zhengyan": 1.3333333730697632
    },
    "loopAnimations": [
      "dongzuo1_zhengchang_zhengyan"
    ],
    "verifiedBlinks": [
      "dongzuo1_kaixin_zhayan",
      "dongzuo1_zhengchang_zhayan",
      "dongzuo1_xianqi_zhayan",
      "dongzuo1_zhoumei_zhayan"
    ],
    "unsupportedExpressionReasons": {},
    "animationAliases": {}
  },
  {
    "slug": "roccia",
    "name": "Roccia",
    "talkerId": 700009,
    "stem": "SolarSchool_Luokeke",
    "version": "4.1.23",
    "metadataFile": "roccia.animation-metadata.json",
    "textureFile": "SolarSchool_Luokeke.webp",
    "dimensions": [
      4096,
      4096
    ],
    "skeletonBytes": 143367,
    "defaultExpression": 700198,
    "sourceAtlas": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Luokeke/SolarSchool_Luokeke.SolarSchool_Luokeke-atlas",
    "sourceSkeleton": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Luokeke/SolarSchool_Luokeke.SolarSchool_Luokeke-data",
    "calibration": {
      "provisional": true,
      "referenceExpression": 700198,
      "anchorX": -323.2788127265692,
      "anchorY": -3619.516845703124,
      "referenceHeight": 6121.452148437498,
      "heightFraction": 0.84
    },
    "poseDurations": {},
    "loopAnimations": [],
    "verifiedBlinks": [
      "dongzuo1_zhengchang_zhayan",
      "dongzuo1_weixiao_zhayan",
      "dongzuo1_shengqi_zhayan",
      "dongzuo1_nanguo_zhayan",
      "dongzuo1_yihuo_zhayan"
    ],
    "unsupportedExpressionReasons": {},
    "animationAliases": {}
  },
  {
    "slug": "verina",
    "name": "Verina",
    "talkerId": 700012,
    "stem": "SolarSchool_Weilinai",
    "version": "4.1.23",
    "metadataFile": "verina.animation-metadata.json",
    "textureFile": "SolarSchool_Weilinai.webp",
    "dimensions": [
      4096,
      2048
    ],
    "skeletonBytes": 120890,
    "defaultExpression": 700136,
    "sourceAtlas": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Weilinai/SolarSchool_Weilinai.SolarSchool_Weilinai-atlas",
    "sourceSkeleton": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Weilinai/SolarSchool_Weilinai.SolarSchool_Weilinai-data",
    "calibration": {
      "provisional": true,
      "referenceExpression": 700136,
      "anchorX": -262.499994346668,
      "anchorY": -3619.499999999999,
      "referenceHeight": 7112.999999999998,
      "heightFraction": 0.84
    },
    "poseDurations": {
      "dongzuo1_zhengchang_zhengyan": 1.3333333730697632,
      "dongzuo1_kaixin_zhengyan": 1.3333333730697632,
      "dongzuo1_shengqi_zhengyan": 1.3333333730697632,
      "dongzuo1_sikao_zhengyan": 1.3333333730697632,
      "dongzuo1_kuxiao_zhengyan": 1.3333333730697632
    },
    "loopAnimations": [
      "dongzuo1_zhengchang_zhengyan",
      "dongzuo1_kaixin_zhengyan",
      "dongzuo1_shengqi_zhengyan",
      "dongzuo1_sikao_zhengyan",
      "dongzuo1_kuxiao_zhengyan"
    ],
    "verifiedBlinks": [
      "dongzuo1_zhengchang_zhayan",
      "dongzuo1_kaixin_zhayan",
      "dongzuo1_shengqi_zhayan",
      "dongzuo1_sikao_zhayan",
      "dongzuo1_kuxiao_zhayan"
    ],
    "unsupportedExpressionReasons": {},
    "animationAliases": {}
  },
  {
    "slug": "rover-male",
    "name": "Rover (male)",
    "talkerId": 850001,
    "stem": "SolarSchool_Male",
    "version": "4.1.23",
    "metadataFile": "rover-male.animation-metadata.json",
    "textureFile": "SolarSchool_Male.webp",
    "dimensions": [
      4096,
      4096
    ],
    "skeletonBytes": 53564,
    "defaultExpression": 700126,
    "sourceAtlas": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Male/SolarSchool_Male.SolarSchool_Male-atlas",
    "sourceSkeleton": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Male/SolarSchool_Male.SolarSchool_Male-data",
    "calibration": {
      "provisional": true,
      "referenceExpression": 700126,
      "anchorX": -469.29976189577815,
      "anchorY": -3562.492187499999,
      "referenceHeight": 7050.147460937498,
      "heightFraction": 0.84
    },
    "poseDurations": {},
    "loopAnimations": [],
    "verifiedBlinks": [
      "dongzuo1_zhengchang_zhayan",
      "dongzuo1_sikao_zhayan"
    ],
    "unsupportedExpressionReasons": {
      "700128": "Source expression 700128 references absent skeleton clips: dongzuo1_yansu_zui.",
      "700129": "Source expression 700129 references absent skeleton clips: dongzuo1_wunai_biyan, dongzuo1_wunai_zui.",
      "700130": "Source expression 700130 references absent skeleton clips: dongzuo1_nanguo_zhayan, dongzuo1_nanguo_zhengyan, dongzuo1_nanguo_zui.",
      "700133": "Source expression 700133 references absent skeleton clips: dongzuo1_yansu_zui.",
      "700134": "Source expression 700134 references absent skeleton clips: dongzuo1_wunai_biyan, dongzuo1_wunai_zui.",
      "700135": "Source expression 700135 references absent skeleton clips: dongzuo1_nanguo_zhayan, dongzuo1_nanguo_zhengyan, dongzuo1_nanguo_zui."
    },
    "animationAliases": {}
  },
  {
    "slug": "rover-female",
    "name": "Rover (female)",
    "talkerId": 850002,
    "stem": "SolarSchool_Female",
    "version": "4.1.23",
    "metadataFile": "rover-female.animation-metadata.json",
    "textureFile": "SolarSchool_Female.webp",
    "dimensions": [
      4096,
      4096
    ],
    "skeletonBytes": 73345,
    "defaultExpression": 700052,
    "sourceAtlas": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Female/SolarSchool_Female.SolarSchool_Female-atlas",
    "sourceSkeleton": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Female/SolarSchool_Female.SolarSchool_Female-data",
    "calibration": {
      "provisional": true,
      "referenceExpression": 700052,
      "anchorX": 257.8655767733246,
      "anchorY": -3211.0926612471426,
      "referenceHeight": 6329.098800223448,
      "heightFraction": 0.84
    },
    "poseDurations": {
      "dongzuo1_zhengchang_zhengyan": 0.6666666865348816,
      "dongzuo1_zhoumei_zhengyan": 0.6666666865348816
    },
    "loopAnimations": [
      "dongzuo1_zhengchang_zhengyan",
      "dongzuo1_zhoumei_zhengyan"
    ],
    "verifiedBlinks": [
      "dongzuo1_zhengchang_zhayan",
      "dongzuo1_zhoumei_zhayan"
    ],
    "unsupportedExpressionReasons": {},
    "animationAliases": {
      "dongzuo1_ zhoumei_zui": "dongzuo1_zhoumei_zui"
    }
  },
  {
    "slug": "xiangli-yao",
    "name": "Xiangli Yao",
    "talkerId": 850003,
    "stem": "SolarSchool_Xiangliyao",
    "version": "4.1.23",
    "metadataFile": "xiangli-yao.animation-metadata.json",
    "textureFile": "SolarSchool_Xiangliyao.webp",
    "dimensions": [
      4096,
      4096
    ],
    "skeletonBytes": 60501,
    "defaultExpression": 700179,
    "sourceAtlas": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Xiangliyao/SolarSchool_Xiangliyao.SolarSchool_Xiangliyao-atlas",
    "sourceSkeleton": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Xiangliyao/SolarSchool_Xiangliyao.SolarSchool_Xiangliyao-data",
    "calibration": {
      "provisional": true,
      "referenceExpression": 700179,
      "anchorX": -233.9181111448388,
      "anchorY": -3731.251220703124,
      "referenceHeight": 7223.922119140623,
      "heightFraction": 0.84
    },
    "poseDurations": {},
    "loopAnimations": [],
    "verifiedBlinks": [
      "dongzuo1_zhangchang_zhayan",
      "dongzuo1_weixiao_zhayan",
      "dongzuo1_yansu_zhayan",
      "dongzuo1_nanguo_zhayan"
    ],
    "unsupportedExpressionReasons": {},
    "animationAliases": {}
  },
  {
    "slug": "galbrena",
    "name": "Galbrena",
    "talkerId": 850009,
    "stem": "SolarSchool_Jiabeilina",
    "version": "4.1.23",
    "metadataFile": "galbrena.animation-metadata.json",
    "textureFile": "SolarSchool_Jiabeilina.webp",
    "dimensions": [
      4096,
      4096
    ],
    "skeletonBytes": 90585,
    "defaultExpression": 700166,
    "sourceAtlas": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Jiabeilina/SolarSchool_Jiabeilina.SolarSchool_Jiabeilina-atlas",
    "sourceSkeleton": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Jiabeilina/SolarSchool_Jiabeilina.SolarSchool_Jiabeilina-data",
    "calibration": {
      "provisional": true,
      "referenceExpression": 700166,
      "anchorX": -83.18600596149736,
      "anchorY": -3945.499999999999,
      "referenceHeight": 6866.999999999998,
      "heightFraction": 0.84
    },
    "poseDurations": {
      "dongzuo1_zhengchang_zhengyan": 1.3333333730697632,
      "dongzuo1_weixiao_zhengyan": 1.3333333730697632,
      "dongzuo1_zhoumei_zhengyan": 1.3333333730697632,
      "dongzuo1_sikao_zhengyan": 1.3333333730697632
    },
    "loopAnimations": [
      "dongzuo1_zhengchang_zhengyan",
      "dongzuo1_weixiao_zhengyan",
      "dongzuo1_zhoumei_zhengyan",
      "dongzuo1_sikao_zhengyan"
    ],
    "verifiedBlinks": [
      "dongzuo1_zhengchang_zhayan",
      "dongzuo1_weixiao_zhayan",
      "dongzuo1_zhoumei_zhayan",
      "dongzuo1_sikao_zhayan"
    ],
    "unsupportedExpressionReasons": {},
    "animationAliases": {}
  },
  {
    "slug": "ciaccona",
    "name": "Ciaccona",
    "talkerId": 850012,
    "stem": "SolarSchool_Xiakong",
    "version": "4.1.23",
    "metadataFile": "ciaccona.animation-metadata.json",
    "textureFile": "SolarSchool_Xiakong.webp",
    "dimensions": [
      4096,
      4096
    ],
    "skeletonBytes": 151075,
    "defaultExpression": 700067,
    "sourceAtlas": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Xiakong/SolarSchool_Xiakong.SolarSchool_Xiakong-atlas",
    "sourceSkeleton": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Xiakong/SolarSchool_Xiakong.SolarSchool_Xiakong-data",
    "calibration": {
      "provisional": true,
      "referenceExpression": 700067,
      "anchorX": 691.3529275578624,
      "anchorY": -4624.170120239257,
      "referenceHeight": 9146.280471801754,
      "heightFraction": 0.84
    },
    "poseDurations": {
      "dongzuo1_zhengchang_zhengtyan": 1.3333333730697632,
      "dongzuo1_luomo_zhengyan": 1.3333333730697632,
      "dongzuo1_shengqi_zhengyan": 1.3333333730697632,
      "dongzuo3_zhengchang_zhengyan": 1.3333333730697632
    },
    "loopAnimations": [
      "dongzuo1_zhengchang_zhengtyan",
      "dongzuo1_luomo_zhengyan",
      "dongzuo1_shengqi_zhengyan",
      "dongzuo3_zhengchang_zhengyan"
    ],
    "verifiedBlinks": [
      "dongzuo1_zhengchang_zhayan",
      "dongzuo1_luomo_zhayan",
      "dongzuo1_shengqi_zhayan",
      "dongzuo3_zhengchang_zhayan"
    ],
    "unsupportedExpressionReasons": {
      "700010": "Source expression 700010 references absent skeleton clips: dongzuo1_kaixin_zhayan, dongzuo1_kaixin_zhengyan."
    },
    "animationAliases": {}
  }
] as const;

export const schoolStaticPortraitData = [
  {
    "talkerId": 700014,
    "name": "Fenrico",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC001.T_IconSolarSchoolNPC001",
    "textureFile": "T_IconSolarSchoolNPC001.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700015,
    "name": "Security Guard",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC002.T_IconSolarSchoolNPC002",
    "textureFile": "T_IconSolarSchoolNPC002.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700016,
    "name": "Security Chief",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC003.T_IconSolarSchoolNPC003",
    "textureFile": "T_IconSolarSchoolNPC003.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700017,
    "name": "Meta",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC004.T_IconSolarSchoolNPC004",
    "textureFile": "T_IconSolarSchoolNPC004.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700018,
    "name": "Townfolk A / Courier",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC005.T_IconSolarSchoolNPC005",
    "textureFile": "T_IconSolarSchoolNPC005.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700019,
    "name": "Student A",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC006.T_IconSolarSchoolNPC006",
    "textureFile": "T_IconSolarSchoolNPC006.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700020,
    "name": "Townfolk B",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC007.T_IconSolarSchoolNPC007",
    "textureFile": "T_IconSolarSchoolNPC007.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700021,
    "name": "Student B",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC008.T_IconSolarSchoolNPC008",
    "textureFile": "T_IconSolarSchoolNPC008.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700022,
    "name": "Student C",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC006.T_IconSolarSchoolNPC006",
    "textureFile": "T_IconSolarSchoolNPC006.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700023,
    "name": "Student D",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC008.T_IconSolarSchoolNPC008",
    "textureFile": "T_IconSolarSchoolNPC008.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700029,
    "name": "Board Member A",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC005.T_IconSolarSchoolNPC005",
    "textureFile": "T_IconSolarSchoolNPC005.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700030,
    "name": "Board Member B",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC007.T_IconSolarSchoolNPC007",
    "textureFile": "T_IconSolarSchoolNPC007.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700031,
    "name": "Celestial Steed Employee",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC002.T_IconSolarSchoolNPC002",
    "textureFile": "T_IconSolarSchoolNPC002.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700032,
    "name": "Celestial Steed Employee Chief",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC003.T_IconSolarSchoolNPC003",
    "textureFile": "T_IconSolarSchoolNPC003.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700033,
    "name": "Orchestra Club Member A",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC009_M.T_IconSolarSchoolNPC009_M",
    "textureFile": "T_IconSolarSchoolNPC009_M.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700034,
    "name": "Orchestra Club Member C",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC009_M.T_IconSolarSchoolNPC009_M",
    "textureFile": "T_IconSolarSchoolNPC009_M.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700037,
    "name": "Orchestra Club Member B",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC009_F.T_IconSolarSchoolNPC009_F",
    "textureFile": "T_IconSolarSchoolNPC009_F.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700038,
    "name": "Orchestra Club Member D",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC009_F.T_IconSolarSchoolNPC009_F",
    "textureFile": "T_IconSolarSchoolNPC009_F.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700043,
    "name": "Doctor",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC007.T_IconSolarSchoolNPC007",
    "textureFile": "T_IconSolarSchoolNPC007.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700045,
    "name": "Reporter A",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC005.T_IconSolarSchoolNPC005",
    "textureFile": "T_IconSolarSchoolNPC005.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  },
  {
    "talkerId": 700046,
    "name": "Reporter B",
    "sourceTexture": "/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconNPC/T_IconSolarSchoolNPC007.T_IconSolarSchoolNPC007",
    "textureFile": "T_IconSolarSchoolNPC007.webp",
    "width": 1016,
    "height": 1548,
    "heightFraction": 0.84
  }
] as const;

export const schoolMissingPortraitData = [
  {
    "talkerId": 850013,
    "name": "Unknown speaker",
    "reason": "Source AvgTalkerConfig 850013 supplies no SolarSchool Spine or portrait texture."
  }
] as const;

/** Explicit shared-resource forms; zero defaults never fabricate a pose. */
export const schoolPortraitAliasData = [
  {
    "talkerId": 700007,
    "resourceTalkerId": 850002,
    "name": "Rover (female alias)",
    "sourceAtlas": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Female/SolarSchool_Female.SolarSchool_Female-atlas",
    "sourceSkeleton": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Female/SolarSchool_Female.SolarSchool_Female-data",
    "defaultExpressionId": 700052
  },
  {
    "talkerId": 700010,
    "resourceTalkerId": 850001,
    "name": "Rover (male alias)",
    "sourceAtlas": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Male/SolarSchool_Male.SolarSchool_Male-atlas",
    "sourceSkeleton": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Male/SolarSchool_Male.SolarSchool_Male-data",
    "defaultExpressionId": 0
  },
  {
    "talkerId": 700013,
    "resourceTalkerId": 700003,
    "name": "Shorekeeper (unnamed)",
    "sourceAtlas": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Shouanren/SolarSchool_Shouanren.SolarSchool_Shouanren-atlas",
    "sourceSkeleton": "/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/SolarSchool_Shouanren/SolarSchool_Shouanren.SolarSchool_Shouanren-data",
    "defaultExpressionId": 0
  }
] as const;
