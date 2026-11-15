"""Install an explicit, small set of already-local Reader UI artwork.

The game installation is never opened. Source WebPs are copied unchanged and
recorded by exact relative path, dimensions, and SHA-256. No screenshot is used.
"""
from pathlib import Path
import hashlib
import json
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'WW_Asset_Webp'
OUT = ROOT / 'public/assets/reader-ui'
BASE = 'UIResources/UiActivity/'
IMAGE = BASE + 'Image/Activity38/SolarSchool/'
ATLAS = BASE + 'Atlas/Activity38/SolarSchool/'
ASSETS = {
    'dialogue-paper': IMAGE + 'Dialogue/T_SolarSchoolDialogueBg.webp',
    'speaker-tape': IMAGE + 'Dialogue/T_SolarSchoolDialogueDesc05.webp',
    'choice-dark': IMAGE + 'Dialogue/T_SolarSchoolDialogueOptionTogNml.webp',
    'choice-light': IMAGE + 'Dialogue/T_SolarSchoolDialogueOptionTogHold.webp',
    'choice-icon': ATLAS + 'Dialogue/SP_SolarSchoolDialogueOptionTogIcon.webp',
    'choice-arrow': ATLAS + 'Dialogue/SP_SolarSchoolDialogueOptionTogSel01.webp',
    'advance-arrow': ATLAS + 'Dialogue/SP_SolarSchoolDialogueArrow.webp',
    'introduction-paper': IMAGE + 'Dialogue/T_SolarSchoolDialogueIntroduction.webp',
    'icon-history': ATLAS + 'Com/SP_SolarSchoolBtn02Record.webp',
    'icon-hide': ATLAS + 'Com/SP_SolarSchoolBtnHide.webp',
    'icon-menu': ATLAS + 'Com/SP_SolarSchoolBtnMenu.webp',
    'icon-settings': ATLAS + 'Map/SP_SolarSchoolMapBtnSet.webp',
    'icon-close': ATLAS + 'Com/SP_SolarSchoolBtnClose.webp',
    'icon-home': ATLAS + 'Com/SP_SolarSchoolBtnHome.webp',
    'icon-book': ATLAS + 'Com/SP_SolarSchoolTabIconRead.webp',
    'icon-rule': ATLAS + 'Com/SP_SolarSchoolBtnRule.webp',
    'menu-circle': ATLAS + 'Overview/SP_SolarSchoolOverviewBtnNor.webp',
    'menu-circle-hover': ATLAS + 'Overview/SP_SolarSchoolOverviewBtnHold.webp',
    'menu-tape': IMAGE + 'Overview/T_SolarSchoolOverviewTitleBg01.webp',
    'pink-stroke': IMAGE + 'Overview/T_SolarSchoolOverviewTitleBg02.webp',
    'menu-texture': IMAGE + 'Overview/T_SolarSchoolOverviewTitleEmptyBg.webp',
    'calendar-frame': IMAGE + 'Map/T_SolarSchooWeather01.webp',
    'calendar-bird': IMAGE + 'Map/T_SolarSchooWeather01Desc01.webp',
    'calendar-pink': IMAGE + 'Map/T_SolarSchooWeatherDescB02L.webp',
    'calendar-grid': IMAGE + 'Map/T_SolarSchooWeatherDescB01L.webp',
    'calendar-ribbon': IMAGE + 'Map/T_SolarSchooWeather01Desc02.webp',
    'loading-paper': 'UIResources/Common/Image/BgCgBig/Activity/Activity38/SolarSchool/T_SolarSchoolLoadingBg.webp',
    'school-emblem': IMAGE + 'Loading/T_SolarSchoolLoadingIcon.webp',
    'school-emblem-caption': IMAGE + 'Loading/T_SolarSchoolLoadingLine.webp',
    'entry-paper-right': IMAGE + 'Entrance/T_SolarSchoolEntranceDesc01.webp',
    'entry-classroom': 'UIResources/Common/Image/BgCgBig/Activity/Activity38/SolarSchool/Bg/T_SolarSchool_MainBg001A.webp',
    'entry-paper-left': IMAGE + 'Entrance/T_SolarSchoolEntranceDesc02.webp',
    'entry-open-icon': IMAGE + 'Entrance/T_SolarSchoolEntranceBtnA01Nml.webp',
    'entry-resume-icon': IMAGE + 'Entrance/T_SolarSchoolEntranceBtnA02Nml.webp',
    'quiz-paper': IMAGE + 'Exam/T_SolarSchoolExamBg01.webp',
    'quiz-answer': IMAGE + 'Exam/T_SolarSchoolExamTogANml.webp',
    'quiz-answer-selected': IMAGE + 'Exam/T_SolarSchoolExamTogAHold.webp',
    'letter-paper': IMAGE + 'Letter/T_SolarSchoolLetterContentBg01.webp',
    'letter-pen': IMAGE + 'Letter/T_SolarSchoolLetterCoverPen.webp',
    'favor-popup-paper': IMAGE + 'Popup/T_SolarSchoolFavorabilityPopupBg01.webp',
    'favor-popup-portrait-paper': IMAGE + 'Popup/T_SolarSchoolFavorabilityPopupRoleBg.webp',
    'favor-popup-stroke': IMAGE + 'Popup/T_SolarSchoolFavorabilityPopupDecs01.webp',
    'favor-popup-title': IMAGE + 'Popup/T_SolaCollegePopupATitle02.webp',
    'favor-confirm-paper': ATLAS + 'Popup/SP_SolaCollegeConfirmBg.webp',
    'favor-tier-icon': IMAGE + 'T_SolarSchoolRoleAffinityIcon00.webp',
}

def source_icon(reference):
    """Retain the exact source path, including its original case."""
    return reference.removeprefix('/Game/Aki/UI/').split('.')[0] + '.webp'

def consequence_assets():
    raw = ROOT / 'WutheringWaves_Data/BinData/SolarSchool'
    assets = {}
    for row in json.loads((raw / 'solarschoolrole.json').read_text()):
        for field, prefix in [('PopupIcon', 'favor-role'), ('HeadIcon', 'favor-head')]:
            if row.get(field):
                assets[f'{prefix}-{row["Id"]}'] = source_icon(row[field])
    for row in json.loads((raw / 'solarschoolattr.json').read_text()):
        if row.get('IconSmall'):
            assets[f'attribute-{row["Id"]}'] = source_icon(row['IconSmall'])
    return assets

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    records = {}
    for name, relative in (ASSETS | consequence_assets()).items():
        src = SOURCE / relative
        if not src.is_file():
            raise SystemExit(f'Exact local UI asset missing: {relative}')
        with Image.open(src) as image:
            image.load()
            width, height = image.size
            alpha = 'A' in image.getbands()
        digest = hashlib.sha256(src.read_bytes()).hexdigest()
        dst = OUT / f'{name}.webp'
        if not dst.exists() or hashlib.sha256(dst.read_bytes()).hexdigest() != digest:
            shutil.copyfile(src, dst)
        records[name] = {'source': relative, 'file': dst.name, 'width': width,
                         'height': height, 'alpha': alpha, 'sha256': digest}
    (OUT / 'manifest.json').write_text(json.dumps({
        'schema': 1, 'source': 'Existing local WW_Asset_Webp cache',
        'policy': 'Exact UI components only; no game extraction or screenshot artwork',
        'assets': records,
    }, indent=2) + '\n')
    print(f'Installed {len(records)} exact local Reader UI assets.')

if __name__ == '__main__':
    main()
