// accessibility.rs — UIAutomation element tree extraction
//
// Uses IUIAutomation COM API to enumerate interactive elements in the currently
// focused window. Provides exact element names, roles, and screen coordinates
// for the AI to use in computer-use actions.

use serde::Serialize;
#[cfg(target_os = "windows")]
use windows::{
    core::BSTR,
    Win32::{
        Foundation::HWND,
        System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED},
        UI::{
            Accessibility::{
                CUIAutomation, IUIAutomation, IUIAutomationElement,
                IUIAutomationExpandCollapsePattern,
                IUIAutomationScrollPattern,
                IUIAutomationSelectionItemPattern,
                IUIAutomationTogglePattern,
                IUIAutomationValuePattern, TreeScope_Subtree,
                UIA_CONTROLTYPE_ID,
                UIA_ButtonControlTypeId, UIA_CheckBoxControlTypeId, UIA_ComboBoxControlTypeId,
                UIA_EditControlTypeId, UIA_HyperlinkControlTypeId, UIA_ListControlTypeId,
                UIA_ListItemControlTypeId,
                UIA_MenuItemControlTypeId, UIA_RadioButtonControlTypeId,
                UIA_TabItemControlTypeId, UIA_TextControlTypeId,
                UIA_TreeControlTypeId, UIA_TreeItemControlTypeId,
                UIA_ExpandCollapsePatternId, UIA_ScrollPatternId,
                UIA_SelectionItemPatternId,
                UIA_TogglePatternId, UIA_ValuePatternId,
            },
            WindowsAndMessaging::GetForegroundWindow,
        },
    },
};

const MAX_ELEMENTS: usize = 80;

#[derive(Debug, Serialize, Clone)]
pub struct UiElement {
    pub name: String,
    pub role: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub enabled: bool,
    pub checked: Option<String>,
    pub value: Option<String>,
    pub expanded: Option<String>,
    pub focused: bool,
    pub selected: Option<bool>,
    pub automation_id: Option<String>,
    // 0-100 vertical scroll % for list/tree containers; None if not scrollable or at top
    pub scroll_pct: Option<u8>,
}

/// Extract interactive UI elements from the foreground window via UIAutomation.
/// Returns an empty list on any error (best-effort, never blocks the AI pipeline).
#[tauri::command]
pub fn get_ui_tree() -> Vec<UiElement> {
    #[cfg(target_os = "windows")]
    match collect_elements() {
        Ok(elements) => elements,
        Err(e) => {
            eprintln!("[accessibility] UIAutomation error: {e:?}");
            Vec::new()
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

#[cfg(target_os = "windows")]
fn collect_elements() -> windows::core::Result<Vec<UiElement>> {
    // Initialize COM STA for this call. If already initialized we continue silently.
    let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let com_newly_init = hr.is_ok();

    let result = try_collect_elements();

    if com_newly_init {
        // Only uninit if we were the ones who inited it
        unsafe { windows::Win32::System::Com::CoUninitialize() };
    }

    result
}

#[cfg(target_os = "windows")]
fn try_collect_elements() -> windows::core::Result<Vec<UiElement>> {
    let automation: IUIAutomation =
        unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)? };

    // Start from the foreground window's root element
    let hwnd: HWND = unsafe { GetForegroundWindow() };
    let root = if hwnd.0.is_null() {
        unsafe { automation.GetRootElement()? }
    } else {
        unsafe { automation.ElementFromHandle(hwnd)? }
    };

    // Collect all descendants
    let condition = unsafe { automation.CreateTrueCondition()? };
    let array = unsafe { root.FindAll(TreeScope_Subtree, &condition)? };

    let count = unsafe { array.Length()? };
    let mut elements = Vec::with_capacity(count.min(MAX_ELEMENTS as i32) as usize);

    // Control type IDs we care about
    let interactive_types: [UIA_CONTROLTYPE_ID; 11] = [
        UIA_ButtonControlTypeId,
        UIA_EditControlTypeId,
        UIA_CheckBoxControlTypeId,
        UIA_RadioButtonControlTypeId,
        UIA_ComboBoxControlTypeId,
        UIA_HyperlinkControlTypeId,
        UIA_MenuItemControlTypeId,
        UIA_ListItemControlTypeId,
        UIA_TabItemControlTypeId,
        UIA_TreeItemControlTypeId,
        UIA_TextControlTypeId,
    ];

    for i in 0..count {
        if elements.len() >= MAX_ELEMENTS {
            break;
        }

        let elem: IUIAutomationElement = unsafe { array.GetElement(i)? };

        let ctrl_type = match unsafe { elem.CurrentControlType() } {
            Ok(t) => t,
            Err(_) => continue,
        };

        if !interactive_types.contains(&ctrl_type) {
            continue;
        }

        let name: BSTR = match unsafe { elem.CurrentName() } {
            Ok(n) if !n.is_empty() => n,
            _ => continue,
        };

        let rect = match unsafe { elem.CurrentBoundingRectangle() } {
            Ok(r) => r,
            Err(_) => continue,
        };

        let width = (rect.right - rect.left).max(0) as u32;
        let height = (rect.bottom - rect.top).max(0) as u32;

        // Skip zero-size elements (likely hidden)
        if width == 0 || height == 0 {
            continue;
        }

        // Skip offscreen elements (scrolled out of view, in collapsed panels)
        let offscreen = unsafe { elem.CurrentIsOffscreen() }
            .map(|b| b.0 != 0)
            .unwrap_or(false);
        if offscreen {
            continue;
        }

        let enabled = unsafe { elem.CurrentIsEnabled() }
            .map(|b| b.0 != 0)
            .unwrap_or(true);

        let checked = if ctrl_type == UIA_CheckBoxControlTypeId
            || ctrl_type == UIA_RadioButtonControlTypeId
        {
            unsafe { elem.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId) }
                .ok()
                .and_then(|tp| unsafe { tp.CurrentToggleState() }.ok())
                .map(|s| match s.0 {
                    1 => "checked".to_string(),
                    2 => "indeterminate".to_string(),
                    _ => "unchecked".to_string(),
                })
        } else {
            None
        };

        let value = if ctrl_type == UIA_EditControlTypeId
            || ctrl_type == UIA_ComboBoxControlTypeId
        {
            unsafe { elem.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) }
                .ok()
                .and_then(|vp| unsafe { vp.CurrentValue() }.ok())
                .map(|v| v.to_string())
                .filter(|v| !v.is_empty())
        } else {
            None
        };

        // ExpandCollapseState: 0=Collapsed, 1=Expanded, 2=PartiallyExpanded, 3=LeafNode
        let expanded = if ctrl_type == UIA_ComboBoxControlTypeId
            || ctrl_type == UIA_TreeItemControlTypeId
            || ctrl_type == UIA_MenuItemControlTypeId
        {
            unsafe { elem.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId) }
                .ok()
                .and_then(|p| unsafe { p.CurrentExpandCollapseState() }.ok())
                .and_then(|s| match s.0 {
                    0 => Some("collapsed".to_string()),
                    1 => Some("expanded".to_string()),
                    2 => Some("partially-expanded".to_string()),
                    _ => None,
                })
        } else {
            None
        };

        let focused = unsafe { elem.CurrentHasKeyboardFocus() }
            .map(|b| b.0 != 0)
            .unwrap_or(false);

        // Selection state for list items (e.g., visible options in an expanded combobox)
        let selected = if ctrl_type == UIA_ListItemControlTypeId {
            unsafe { elem.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId) }
                .ok()
                .and_then(|p| unsafe { p.CurrentIsSelected() }.ok())
                .map(|b| b.0 != 0)
        } else {
            None
        };

        // AutomationId: programmatic identifier; only surface it when it looks meaningful
        // (contains letters, not a bare integer, not identical to name). Bare integers like
        // "1001" and GUID fragments add noise without helping the AI disambiguate.
        let automation_id = unsafe { elem.CurrentAutomationId() }
            .ok()
            .map(|s| s.to_string())
            .filter(|s| {
                !s.is_empty()
                    && s != &name.to_string()
                    && s.chars().any(|c| c.is_alphabetic())  // must contain at least one letter
                    && s.len() <= 64                          // skip GUID-length noise
            });

        elements.push(UiElement {
            name: name.to_string(),
            role: ctrl_type_to_role(ctrl_type),
            x: rect.left,
            y: rect.top,
            width,
            height,
            enabled,
            checked,
            value,
            expanded,
            focused,
            selected,
            automation_id,
            scroll_pct: None,
        });
    }

    // Second pass: collect scroll containers (List, Tree) that are visible.
    // For each scrollable container, emit a sentinel element so the AI knows
    // how far down the list has been scrolled (e.g., "50% down, more items below").
    let scroll_types: [UIA_CONTROLTYPE_ID; 2] = [UIA_ListControlTypeId, UIA_TreeControlTypeId];
    for i in 0..count {
        let elem: IUIAutomationElement = match unsafe { array.GetElement(i) } {
            Ok(e) => e,
            Err(_) => continue,
        };
        let ctrl_type = match unsafe { elem.CurrentControlType() } {
            Ok(t) => t,
            Err(_) => continue,
        };
        if !scroll_types.contains(&ctrl_type) {
            continue;
        }
        let offscreen = unsafe { elem.CurrentIsOffscreen() }
            .map(|b| b.0 != 0)
            .unwrap_or(true);
        if offscreen {
            continue;
        }
        // Only report if actually scrolled (> 0%) — no noise when at top
        let pct = unsafe { elem.GetCurrentPatternAs::<IUIAutomationScrollPattern>(UIA_ScrollPatternId) }
            .ok()
            .and_then(|p| unsafe { p.CurrentVerticalScrollPercent() }.ok())
            .filter(|&p| p > 0.0 && p <= 100.0)
            .map(|p| p.round() as u8);

        if let Some(pct_val) = pct {
            let name: BSTR = unsafe { elem.CurrentName() }
                .unwrap_or_default();
            let rect = match unsafe { elem.CurrentBoundingRectangle() } {
                Ok(r) => r,
                Err(_) => continue,
            };
            let role = if ctrl_type == UIA_ListControlTypeId { "list" } else { "tree" };
            elements.push(UiElement {
                name: if name.is_empty() {
                    format!("{role} container")
                } else {
                    name.to_string()
                },
                role: role.to_string(),
                x: rect.left,
                y: rect.top,
                width: (rect.right - rect.left).max(0) as u32,
                height: (rect.bottom - rect.top).max(0) as u32,
                enabled: true,
                checked: None,
                value: None,
                expanded: None,
                focused: false,
                selected: None,
                automation_id: None,
                scroll_pct: Some(pct_val),
            });
        }
    }

    Ok(elements)
}

#[cfg(target_os = "windows")]
fn ctrl_type_to_role(ctrl_type: UIA_CONTROLTYPE_ID) -> String {
    match ctrl_type {
        t if t == UIA_ButtonControlTypeId => "button",
        t if t == UIA_EditControlTypeId => "edit",
        t if t == UIA_CheckBoxControlTypeId => "checkbox",
        t if t == UIA_RadioButtonControlTypeId => "radiobutton",
        t if t == UIA_ComboBoxControlTypeId => "combobox",
        t if t == UIA_HyperlinkControlTypeId => "link",
        t if t == UIA_MenuItemControlTypeId => "menuitem",
        t if t == UIA_ListItemControlTypeId => "listitem",
        t if t == UIA_TabItemControlTypeId => "tabitem",
        t if t == UIA_TreeItemControlTypeId => "treeitem",
        t if t == UIA_TextControlTypeId => "text",
        _ => "element",
    }
    .to_string()
}
