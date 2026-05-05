// accessibility.rs — UIAutomation element tree extraction
// Walks the focused application's UI tree and returns element names, roles,
// and bounding rectangles. Injected into the AI context for precise targeting.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct UiElement {
    pub name: String,
    pub role: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Extract interactive UI elements from the foreground window.
/// Returns a JSON-serializable list of elements with name, role, and bounds.
/// Returns empty list on any failure — caller treats as best-effort.
#[tauri::command]
pub fn get_ui_tree() -> Vec<UiElement> {
    get_ui_tree_inner().unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn get_ui_tree_inner() -> Result<Vec<UiElement>, String> {
    use windows::{
        Win32::{
            Foundation::HWND,
            System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED},
            UI::{
                Accessibility::{
                    CUIAutomation, IUIAutomation, IUIAutomationCondition, IUIAutomationElement,
                    IUIAutomationElementArray, TreeScope_Subtree, UIA_ButtonControlTypeId,
                    UIA_CheckBoxControlTypeId, UIA_ComboBoxControlTypeId, UIA_EditControlTypeId,
                    UIA_HyperlinkControlTypeId, UIA_ListItemControlTypeId, UIA_MenuItemControlTypeId,
                    UIA_RadioButtonControlTypeId, UIA_TabItemControlTypeId, UIA_TextControlTypeId,
                    UIA_TreeItemControlTypeId,
                },
                WindowsAndMessaging::GetForegroundWindow,
            },
        },
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| e.to_string())?;

        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return Ok(vec![]);
        }

        let root: IUIAutomationElement = automation
            .ElementFromHandle(hwnd)
            .map_err(|e| e.to_string())?;

        // Build an OR condition for common interactive control types
        let interesting_types = [
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

        // Create individual type conditions
        let mut conditions: Vec<IUIAutomationCondition> = Vec::new();
        for type_id in &interesting_types {
            let cond = automation
                .CreatePropertyCondition(
                    windows::Win32::UI::Accessibility::UIA_ControlTypePropertyId,
                    &windows::core::VARIANT::from(type_id.0 as i32),
                )
                .map_err(|e| e.to_string())?;
            conditions.push(cond);
        }

        // Chain them with OR
        let mut combined: IUIAutomationCondition = conditions.remove(0);
        for cond in conditions {
            combined = automation
                .CreateOrCondition(&combined, &cond)
                .map_err(|e| e.to_string())?;
        }

        let elements: IUIAutomationElementArray = root
            .FindAll(TreeScope_Subtree, &combined)
            .map_err(|e| e.to_string())?;

        let count = elements.Length().map_err(|e| e.to_string())?;
        let mut result = Vec::new();

        for i in 0..count.min(80) {  // cap at 80 elements to avoid token overflow
            let el: IUIAutomationElement = elements.GetElement(i).map_err(|e| e.to_string())?;

            let name = el.CurrentName()
                .map(|s| s.to_string())
                .unwrap_or_default();
            if name.is_empty() {
                continue;
            }

            let role = el.CurrentLocalizedControlType()
                .map(|s| s.to_string())
                .unwrap_or_else(|_| "element".to_string());

            let rect = el.CurrentBoundingRectangle().unwrap_or_default();

            result.push(UiElement {
                name,
                role,
                x: rect.left,
                y: rect.top,
                width: (rect.right - rect.left).max(0) as u32,
                height: (rect.bottom - rect.top).max(0) as u32,
            });
        }

        Ok(result)
    }
}

#[cfg(not(target_os = "windows"))]
fn get_ui_tree_inner() -> Result<Vec<UiElement>, String> {
    Ok(vec![])
}
