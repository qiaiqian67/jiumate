; Custom NSIS include for the JiuMate installer.
;
; electron-builder injects this file **before** installer.nsi: the final script is
; [StdUtils + messages + THIS FILE] + [installer.nsi, which includes MUI2.nsh]. Four consequences,
; every one of them learned from makensis aborting on this file, and together the reason it is
; written the way it is:
;
;   1. **No MUI macro may appear in a Function body here.** A Function is compiled where it is
;      written, and MUI2 is not in scope yet — `!insertmacro MUI_HEADER_TEXT` inside a page
;      callback fails with "macro not found". These pages draw their own header with nsDialogs.
;   2. **No LogicLib macro either, and adding `!include LogicLib.nsh` does not help** —
;      `${If} cond` still failed with `macro "_If" requires 4 parameter(s), passed 2`, resolving
;      to a two-parameter stub rather than LogicLib's macro. MUI2 and LogicLib arrive together,
;      after this file. So every conditional here is plain NSIS: `StrCmp` + `Goto` + labels,
;      and `IfErrors` rather than `${Errors}`.
;   3. **The script is compiled twice** — once for the installer, once for the uninstaller — and
;      this file is included in both. assistedInstaller.nsh inserts its page macros inside
;      `!ifndef BUILD_UNINSTALLER`, so in the uninstaller pass the page callbacks below would be
;      defined and never referenced (warning 6010) and their Vars never set (warning 6001).
;      electron-builder escalates warnings to hard errors, so both the Functions and their Var
;      declarations live inside one `!ifndef BUILD_UNINSTALLER` guard.
;   4. **`$(...)` is LangString lookup, not constant interpolation.** The `!define`s below are
;      referenced as `${...}`; written as `$(...)` makensis looks for a language-table entry that
;      was never registered (warning 6040).
;
; `WinMessages.nsh` and `nsDialogs.nsh` *are* reachable from here — they live in the stock NSIS
; Include directory, unlike MUI2 and LogicLib.
;
; What this file does:
;
;   1. Drops the install-mode page ("install for all users / for me"). electron-builder shows that
;      page whenever both per-machine and per-user installs are possible; `customInstallMode` is the
;      hook it checks, and setting $isForceCurrentInstall makes it pick per-user and Abort the page.
;      Chosen over `perMachine: true` because that installs machine-wide and forces an elevation
;      prompt, while this app is per-user by design (app-identity.ts, cli-install.ts).
;   2. Runs a first-run flow in the installer: language, prepare, model, appearance.
;   3. Writes the answers to %APPDATA%\JiuMate\setup.ini, which the app reads on first launch.
;      That handoff is why these pages belong in the installer at all: the answers are collected
;      before the app has ever run.
;
; **Page order is not free.** assistedInstaller.nsh emits, in order: install mode (skipped above),
; `MUI_PAGE_DIRECTORY`, then whatever `customPageAfterChangeDir` inserts. `customWelcomePage` is
; the only hook that lands BEFORE the directory page, so the language page goes there — putting it
; in `customPageAfterChangeDir` would ask for the language after the install folder.
;
; **The API key is deliberately not asked for here.** A secret typed into an installer dialog lands
; in a plaintext file beside the install tree, and the installer runs at a different privilege level
; and in a different place than the app does. The app asks for it once, in a process that can keep
; it in the OS credential store.
;
; NSIS has no layout engine and no web view, so these pages are Win32 controls — fields, radio
; groups and labels. The reference design's card grid is not reproducible inside an installer; that
; is a property of the installer, not a shortcut.

!include WinMessages.nsh
!include nsDialogs.nsh

; --- strings ---------------------------------------------------------------------------------
; One table, bilingual by construction rather than switched: every string carries both languages
; and the language page is what decides which one the app uses afterwards. Compiling two language
; tables would mean asking the user the same question twice, and would make every later string a
; lookup that can silently miss.

!define STR_LANG_TITLE      "语言 / Language"
!define STR_LANG_DESC       "用于安装过程与应用首次启动。"
!define STR_LANG_ZH         "简体中文"
!define STR_LANG_EN         "English"
!define STR_LANG_FOLLOW_SYS "跟随系统"

!define STR_PREP_TITLE      "准备 / Prepare"
!define STR_PREP_DIR        "安装目录"
!define STR_PREP_CLI        "将 jiumate 命令加入 PATH"
!define STR_PREP_CLI_DESC   "可在任意目录用命令行启动本应用"
!define STR_PREP_REQUIRED   "所需空间"
!define STR_PREP_AVAILABLE  "可用空间"
!define STR_PREP_SIZE_TBD   "待测量"

!define STR_MODEL_TITLE     "连接模型 / Connect a model"
!define STR_MODEL_PROVIDER  "提供商"
!define STR_MODEL_NAME      "模型"
!define STR_MODEL_LATER     "稍后配置"

!define STR_THEME_TITLE     "外观 / Appearance"
!define STR_THEME_DESC      "之后也可以随时更换。"
!define STR_THEME_DEFAULT   "默认（亮色）"
!define STR_THEME_DARK      "暗色"
!define STR_THEME_SYSTEM    "跟随系统"

!define SETUP_INI_NAME "setup.ini"

; --- 0. the install-mode page -----------------------------------------------------------------
; Checked inside FUNCTION_INSTALL_MODE_PAGE_FUNCTION before the page is built. Setting the force
; flag makes it call setInstallModePerUser and Abort, so nsDialogs never runs and the user never
; sees "install for all users / for me".

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; --- page order -------------------------------------------------------------------------------

!macro customWelcomePage
  PageEx custom
    PageCallbacks SetupLang_Create SetupLang_Leave
  PageExEnd
!macroend

!macro customPageAfterChangeDir
  PageEx custom
    PageCallbacks SetupPrep_Create SetupPrep_Leave
  PageExEnd

  PageEx custom
    PageCallbacks SetupModel_Create SetupModel_Leave
  PageExEnd

  PageEx custom
    PageCallbacks SetupTheme_Create SetupTheme_Leave
  PageExEnd
!macroend

!macro customFinishPage
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customInit
  StrCpy $SetupLang "system"
  StrCpy $SetupCli "1"
  StrCpy $SetupProvider "deepseek"
  StrCpy $SetupModel ""
  StrCpy $SetupTheme "light"
  StrCpy $SetupSkipModel "1"
!macroend

; --- shared page furniture ---------------------------------------------------------------------
; Our own header instead of MUI_HEADER_TEXT, for the include-order reason at the top. Both labels
; are created unconditionally and the description is simply empty on the pages that have none —
; the only way to branch inside a macro here is LogicLib's `${If}`, and that is not in scope yet.
!macro SetupHeader TITLE DESC
  ${NSD_CreateLabel} 14u 14u 380u 20u "${TITLE}"
  Pop $0
  ${NSD_CreateLabel} 14u 36u 380u 16u "${DESC}"
  Pop $0
!macroend

!ifndef BUILD_UNINSTALLER

; Answers collected across the flow. Declared inside this guard for the same reason the Functions
; are: the uninstaller pass never inserts these pages, and a Var nothing references is warning 6001,
; which electron-builder also treats as fatal.
Var SetupLang        ; "zh" | "en" | "system"
Var SetupCli         ; "1" | "0"
Var SetupProvider
Var SetupModel
Var SetupTheme       ; "light" | "dark" | "system"
Var SetupSkipModel   ; "1" when the user chose to configure the model later

; Control handles live in Vars, not $0-$9: they are read again in the Leave callback, and a
; register touched by anything in between would leave the page reading the wrong control.
Var LangSystem
Var LangZh
Var LangEn
Var PrepCli
Var ModelProvider
Var ModelName
Var ModelLater
Var ThemeLight
Var ThemeDark
Var ThemeSystem

; --- page: language ----------------------------------------------------------------------------

Function SetupLang_Create
  nsDialogs::Create 1018
  Pop $0
  IfErrors lang_create_done
  !insertmacro SetupHeader "${STR_LANG_TITLE}" "${STR_LANG_DESC}"

  ${NSD_CreateRadioButton} 20u 74u 260u 16u "${STR_LANG_FOLLOW_SYS}"
  Pop $LangSystem
  ${NSD_CreateRadioButton} 20u 98u 260u 16u "${STR_LANG_ZH}"
  Pop $LangZh
  ${NSD_CreateRadioButton} 20u 122u 260u 16u "${STR_LANG_EN}"
  Pop $LangEn

  ; "Follow the system" is checked by default, and no OS-language probing is attempted: the
  ; ${LANG_*} LCID constants this would branch on come from WinLang.nsh, and pre-selecting is a
  ; nicety worth less than the user simply being able to pick.
  ${NSD_Check} $LangSystem

  nsDialogs::Show
lang_create_done:
FunctionEnd

Function SetupLang_Leave
  ${NSD_GetState} $LangZh $8
  IntCmp $8 0 lang_next
  StrCpy $SetupLang "zh"
  Return
lang_next:
  ${NSD_GetState} $LangEn $8
  IntCmp $8 0 lang_last
  StrCpy $SetupLang "en"
  Return
lang_last:
  StrCpy $SetupLang "system"
FunctionEnd

; --- page: prepare -----------------------------------------------------------------------------

Function SetupPrep_Create
  nsDialogs::Create 1018
  Pop $0
  IfErrors prep_create_done
  !insertmacro SetupHeader "${STR_PREP_TITLE}" ""

  ${NSD_CreateLabel} 20u 58u 60u 16u "${STR_PREP_DIR}"
  Pop $0
  ${NSD_CreateText} 84u 56u 306u 16u ""
  Pop $0
  ; Read-only: the folder is chosen on the directory page MUI already showed. Echoing it here
  ; repeats information without letting it be changed in two places that could then disagree.
  StrCpy $0 "$INSTDIR"
  EnableWindow $0 0

  ; Both figures are placeholders. Nobody has measured an installer as a release artifact (a
  ; current build is ~139 MB compressed / ~466 MB unpacked, and drifts every release), and a number
  ; written before the fact would be a guess wearing the costume of a measurement. The app can
  ; report free space for real.
  ${NSD_CreateLabel} 20u 86u 380u 16u "${STR_PREP_REQUIRED}: ${STR_PREP_SIZE_TBD}"
  Pop $0
  ${NSD_CreateLabel} 20u 106u 380u 16u "${STR_PREP_AVAILABLE}: ${STR_PREP_SIZE_TBD}"
  Pop $0

  ${NSD_CreateCheckBox} 20u 138u 380u 16u "${STR_PREP_CLI}"
  Pop $PrepCli
  ${NSD_Check} $PrepCli
  ${NSD_CreateLabel} 20u 158u 380u 16u "${STR_PREP_CLI_DESC}"
  Pop $0

  nsDialogs::Show
prep_create_done:
FunctionEnd

Function SetupPrep_Leave
  ${NSD_GetState} $PrepCli $8
  IntCmp $8 0 prep_cli_off
  StrCpy $SetupCli "1"
  Return
prep_cli_off:
  StrCpy $SetupCli "0"
FunctionEnd

; --- page: model -------------------------------------------------------------------------------

Function SetupModel_Create
  nsDialogs::Create 1018
  Pop $0
  IfErrors model_create_done
  !insertmacro SetupHeader "${STR_MODEL_TITLE}" ""

  ${NSD_CreateLabel} 20u 58u 56u 16u "${STR_MODEL_PROVIDER}"
  Pop $0
  ; CBS_DROPDOWNLIST rather than an editable combo: these five ids are what the model catalog
  ; knows, and a box that accepted anything would let the user pick a provider with no model
  ; behind it. The default style nsDialogs applies (CBS_DROPDOWN | CBS_AUTOHSCROLL) is editable,
  ; so the style is spelled out here.
  ${NSD_CreateComboBox} 80u 56u 310u 22u "" "" ${CBS_DROPDOWNLIST}|${CBS_AUTOHSCROLL}
  Pop $ModelProvider
  ; `NSD_CB_AddString` is the real nsDialogs spelling (the plugin prefixes its combo-box calls
  ; NSD_CB_*). The order here is the order SetupModel_Leave maps by index, so the two must stay in
  ; step.
  ${NSD_CB_AddString} $ModelProvider "DeepSeek"
  ${NSD_CB_AddString} $ModelProvider "Anthropic"
  ${NSD_CB_AddString} $ModelProvider "OpenAI"
  ${NSD_CB_AddString} $ModelProvider "Google"
  ${NSD_CB_AddString} $ModelProvider "Ollama"
  ${NSD_CB_SelectString} $ModelProvider "DeepSeek"

  ${NSD_CreateLabel} 20u 90u 56u 16u "${STR_MODEL_NAME}"
  Pop $0
  ${NSD_CreateText} 80u 88u 310u 16u ""
  Pop $ModelName

  ${NSD_CreateCheckBox} 20u 122u 380u 16u "${STR_MODEL_LATER}"
  Pop $ModelLater
  ; Checked by default: a wizard that insists on a model id before it will let anyone continue is a
  ; wizard that cannot be finished, and most people skip this on the first run anyway.
  ${NSD_Check} $ModelLater

  nsDialogs::Show
model_create_done:
FunctionEnd

Function SetupModel_Leave
  ; Index 0 is the first string added above, hence the four `IntCmp $8 N` guards falling through
  ; to index 0: negative (CB_ERR) and out-of-range both land on DeepSeek, the same default the
  ; combo itself starts on.
  ${NSD_CB_GetSelectionIndex} $ModelProvider $8
  IntCmp $8 1 model_p2
  IntCmp $8 2 model_p3
  IntCmp $8 3 model_p4
  IntCmp $8 4 model_p5
  StrCpy $SetupProvider "deepseek"
  Goto model_provider_done
model_p2:
  StrCpy $SetupProvider "anthropic"
  Goto model_provider_done
model_p3:
  StrCpy $SetupProvider "openai"
  Goto model_provider_done
model_p4:
  StrCpy $SetupProvider "google"
  Goto model_provider_done
model_p5:
  StrCpy $SetupProvider "ollama"
model_provider_done:

  ${NSD_GetText} $ModelName $SetupModel

  ${NSD_GetState} $ModelLater $8
  IntCmp $8 0 model_not_skipped
  StrCpy $SetupSkipModel "1"
  Return
model_not_skipped:
  StrCpy $SetupSkipModel "0"
FunctionEnd

; --- page: appearance --------------------------------------------------------------------------

Function SetupTheme_Create
  nsDialogs::Create 1018
  Pop $0
  IfErrors theme_create_done
  !insertmacro SetupHeader "${STR_THEME_TITLE}" "${STR_THEME_DESC}"

  ${NSD_CreateRadioButton} 20u 74u 260u 16u "${STR_THEME_DEFAULT}"
  Pop $ThemeLight
  ${NSD_CreateRadioButton} 20u 98u 260u 16u "${STR_THEME_DARK}"
  Pop $ThemeDark
  ${NSD_CreateRadioButton} 20u 122u 260u 16u "${STR_THEME_SYSTEM}"
  Pop $ThemeSystem

  ${NSD_Check} $ThemeLight

  nsDialogs::Show
theme_create_done:

  ; Written here, on the last page's create, rather than in a Section: the answers must not exist
  ; unless the user reached the end of the flow, so a failed copy leaves no file claiming this
  ; install was configured.
  ;
  ; %APPDATA%\JiuMate is the packaged app's userData — app.setName("JiuMate") runs before anything
  ; reads it (app-identity.ts) — which is where the app looks for it.
  ;
  ; `${VERSION}` is the define electron-builder actually passes (common.nsh's BrandingText reads
  ; "${PRODUCT_NAME} ${VERSION}"). `${APP_VERSION}` does not exist, and an unknown constant is a
  ; hard error rather than a warning.
  ClearErrors
  CreateDirectory "$APPDATA\JiuMate"
  WriteINIStr "$APPDATA\JiuMate\${SETUP_INI_NAME}" "setup" "lang" "$SetupLang"
  WriteINIStr "$APPDATA\JiuMate\${SETUP_INI_NAME}" "setup" "installCli" "$SetupCli"
  WriteINIStr "$APPDATA\JiuMate\${SETUP_INI_NAME}" "setup" "theme" "$SetupTheme"
  WriteINIStr "$APPDATA\JiuMate\${SETUP_INI_NAME}" "setup" "provider" "$SetupProvider"
  WriteINIStr "$APPDATA\JiuMate\${SETUP_INI_NAME}" "setup" "model" "$SetupModel"
  WriteINIStr "$APPDATA\JiuMate\${SETUP_INI_NAME}" "setup" "skipModel" "$SetupSkipModel"
  WriteINIStr "$APPDATA\JiuMate\${SETUP_INI_NAME}" "setup" "installerVersion" "${VERSION}"
  ; Not fatal, and deliberately not a MessageBox: the app falls back to its own defaults, which is
  ; exactly what a user who never ran this installer gets. Blocking an otherwise complete install
  ; over an optional preferences file would be the worse outcome.
  IfErrors 0 +1
  DetailPrint "setup: could not write ${SETUP_INI_NAME}"
FunctionEnd

Function SetupTheme_Leave
  ${NSD_GetState} $ThemeDark $8
  IntCmp $8 0 theme_next
  StrCpy $SetupTheme "dark"
  Return
theme_next:
  ${NSD_GetState} $ThemeSystem $8
  IntCmp $8 0 theme_last
  StrCpy $SetupTheme "system"
  Return
theme_last:
  StrCpy $SetupTheme "light"
FunctionEnd

!endif ; !ifndef BUILD_UNINSTALLER — see the note at the top of this file.
