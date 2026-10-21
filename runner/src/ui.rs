//! Win32 window and tray icon of the runner.
//!
//! Everything runs on the UI thread: the `unsafe` blocks only cover FFI calls
//! on handles created and owned by this module.

use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, COLOR_GRAYTEXT, COLOR_WINDOW, COLOR_WINDOWTEXT, CreateCompatibleBitmap,
    CreateCompatibleDC, CreateFontW, DT_END_ELLIPSIS, DT_LEFT, DT_NOPREFIX, DT_SINGLELINE,
    DT_WORDBREAK, DeleteDC, DeleteObject, DrawTextW, EndPaint, FF_DONTCARE, FW_BOLD, FW_NORMAL,
    FillRect, GetSysColor, GetSysColorBrush, HDC, HFONT, HGDIOBJ, InvalidateRect, PAINTSTRUCT,
    SRCCOPY, SelectObject, SetBkMode, SetTextColor, TRANSPARENT, UpdateWindow,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::SystemInformation::GetTickCount64;
use windows_sys::Win32::UI::HiDpi::GetDpiForSystem;
use windows_sys::Win32::UI::Shell::{
    NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NOTIFYICONDATAW, Shell_NotifyIconW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AdjustWindowRectEx, AppendMenuW, BS_PUSHBUTTON, CREATESTRUCTW, CS_HREDRAW, CS_VREDRAW,
    CW_USEDEFAULT, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DestroyWindow,
    DispatchMessageW, GWLP_USERDATA, GetCursorPos, GetMessageW, GetWindowLongPtrW, HICON,
    IDC_ARROW, IDI_APPLICATION, IsDialogMessageW, IsWindowVisible, KillTimer, LoadCursorW,
    LoadIconW, MF_SEPARATOR, MF_STRING, MSG, PostMessageW, PostQuitMessage, RegisterClassExW,
    RegisterWindowMessageW, SW_HIDE, SW_RESTORE, SW_SHOW, SW_SHOWMINNOACTIVE, SW_SHOWNOACTIVATE, SendMessageW,
    SetForegroundWindow, SetTimer, SetWindowLongPtrW, ShowWindow, TPM_RIGHTBUTTON, TrackPopupMenu,
    TranslateMessage, WM_APP, WM_COMMAND, WM_CONTEXTMENU, WM_CREATE, WM_DESTROY, WM_ERASEBKGND,
    WM_LBUTTONUP, WM_NCCREATE, WM_NCDESTROY, WM_NULL, WM_PAINT, WM_RBUTTONUP, WM_SETFONT,
    WM_TIMER, WNDCLASSEXW, WS_CAPTION, WS_CHILD, WS_CLIPCHILDREN, WS_MINIMIZEBOX, WS_OVERLAPPED,
    WS_SYSMENU, WS_TABSTOP, WS_VISIBLE,
};

use crate::cli::{Lang, Options, WindowMode};

const WM_TRAY: u32 = WM_APP + 1;
const TRAY_UID: u32 = 1;
const TIMER_UPTIME: usize = 1;

const ID_BUTTON_HIDE: usize = 1001;
const ID_BUTTON_QUIT: usize = 1002;
const ID_MENU_TOGGLE: usize = 2001;
const ID_MENU_QUIT: usize = 2002;

/// Icon resource embedded by `runner.rc`.
const ICON_RESOURCE_ID: usize = 1;

// Dimensions logiques (96 dpi) de la zone cliente.
const CLIENT_WIDTH: i32 = 420;
const CLIENT_HEIGHT: i32 = 236;
const MARGIN: i32 = 24;

struct Strings {
    subtitle: &'static str,
    running_for: &'static str,
    hide_button: &'static str,
    quit_button: &'static str,
    menu_show: &'static str,
    menu_hide: &'static str,
    menu_quit: &'static str,
}

impl Strings {
    fn for_lang(lang: Lang) -> Self {
        match lang {
            Lang::Fr => Self {
                subtitle: "Processus factice : il permet à Discord de détecter ce jeu.",
                running_for: "En cours depuis",
                hide_button: "Réduire dans la barre",
                quit_button: "Quitter",
                menu_show: "Afficher",
                menu_hide: "Masquer",
                menu_quit: "Quitter",
            },
            Lang::En => Self {
                subtitle: "Placeholder process: it lets Discord detect this game.",
                running_for: "Running for",
                hide_button: "Hide to tray",
                quit_button: "Quit",
                menu_show: "Show",
                menu_hide: "Hide",
                menu_quit: "Quit",
            },
        }
    }
}

struct State {
    title: String,
    strings: Strings,
    started_at_ms: u64,
    dpi: u32,
    font_caption: HFONT,
    font_title: HFONT,
    font_body: HFONT,
    taskbar_created: u32,
}

impl State {
    fn scale(&self, logical: i32) -> i32 {
        logical * self.dpi as i32 / 96
    }

    fn uptime_text(&self) -> String {
        // SAFETY: no preconditions.
        let elapsed = unsafe { GetTickCount64() }.saturating_sub(self.started_at_ms) / 1000;
        format!(
            "{} {:02}:{:02}:{:02}",
            self.strings.running_for,
            elapsed / 3600,
            elapsed / 60 % 60,
            elapsed % 60
        )
    }

    fn rect(&self, top: i32, height: i32) -> RECT {
        RECT {
            left: self.scale(MARGIN),
            top: self.scale(top),
            right: self.scale(CLIENT_WIDTH - MARGIN),
            bottom: self.scale(top + height),
        }
    }

    fn caption_rect(&self) -> RECT {
        self.rect(22, 18)
    }
    fn title_rect(&self) -> RECT {
        self.rect(44, 56)
    }
    fn subtitle_rect(&self) -> RECT {
        self.rect(108, 36)
    }
    fn uptime_rect(&self) -> RECT {
        self.rect(148, 20)
    }
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn utf16(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn make_int_resource(id: usize) -> *const u16 {
    id as *const u16
}

/// # Safety
/// Must be called from the UI thread.
unsafe fn load_app_icon() -> HICON {
    // SAFETY: the identifier is an embedded icon resource or, failing that, a system icon.
    unsafe {
        let module = GetModuleHandleW(null());
        let icon = LoadIconW(module, make_int_resource(ICON_RESOURCE_ID));
        if icon.is_null() {
            LoadIconW(null_mut(), IDI_APPLICATION)
        } else {
            icon
        }
    }
}

/// # Safety
/// `facename` must be NUL-terminated.
unsafe fn create_font(height_px: i32, weight: u32, facename: &[u16]) -> HFONT {
    // SAFETY: every parameter is a plain value or a valid pointer.
    unsafe {
        CreateFontW(
            -height_px,
            0,
            0,
            0,
            weight as i32,
            0,
            0,
            0,
            1, // DEFAULT_CHARSET
            0,
            0,
            5, // CLEARTYPE_QUALITY
            FF_DONTCARE as u32,
            facename.as_ptr(),
        )
    }
}

/// # Safety
/// `hdc` and `font` must be valid handles.
unsafe fn draw_text(hdc: HDC, font: HFONT, color: u32, text: &[u16], mut rect: RECT, flags: u32) {
    // SAFETY: handles are valid per the caller's contract; `text` stays borrowed during the call.
    unsafe {
        let previous = SelectObject(hdc, font as HGDIOBJ);
        SetTextColor(hdc, color);
        DrawTextW(hdc, text.as_ptr(), text.len() as i32, &mut rect, flags);
        SelectObject(hdc, previous);
    }
}

/// # Safety
/// `hwnd` must be the main window.
unsafe fn tray_data(hwnd: HWND, state: &State) -> NOTIFYICONDATAW {
    // SAFETY: NOTIFYICONDATAW is a C struct for which all-zero is a valid value.
    let mut data: NOTIFYICONDATAW = unsafe { zeroed() };
    data.cbSize = size_of::<NOTIFYICONDATAW>() as u32;
    data.hWnd = hwnd;
    data.uID = TRAY_UID;
    data.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    data.uCallbackMessage = WM_TRAY;
    // SAFETY: thread d'interface.
    data.hIcon = unsafe { load_app_icon() };

    // On garde la place du NUL final dans `szTip`.
    let capacity = data.szTip.len() - 1;
    for (slot, unit) in data.szTip.iter_mut().zip(state.title.encode_utf16().take(capacity)) {
        *slot = unit;
    }
    data
}

/// # Safety
/// `hwnd` must be the main window.
unsafe fn add_tray_icon(hwnd: HWND, state: &State) {
    // SAFETY: `data` is fully initialized by `tray_data`.
    unsafe {
        let data = tray_data(hwnd, state);
        Shell_NotifyIconW(NIM_ADD, &data);
    }
}

/// # Safety
/// `hwnd` must be the main window.
unsafe fn remove_tray_icon(hwnd: HWND, state: &State) {
    // SAFETY: voir `add_tray_icon`.
    unsafe {
        let data = tray_data(hwnd, state);
        Shell_NotifyIconW(NIM_DELETE, &data);
    }
}

/// # Safety
/// `hwnd` must be the main window.
unsafe fn toggle_window(hwnd: HWND) {
    // SAFETY: only changes the visibility of our own window.
    unsafe {
        if IsWindowVisible(hwnd) != 0 {
            ShowWindow(hwnd, SW_HIDE);
        } else {
            ShowWindow(hwnd, SW_SHOW);
            ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);
        }
    }
}

/// # Safety
/// `hwnd` must be the main window.
unsafe fn show_tray_menu(hwnd: HWND, state: &State) {
    // SAFETY: the menu is created, used and destroyed within this function.
    unsafe {
        let menu = CreatePopupMenu();
        if menu.is_null() {
            return;
        }

        let toggle_label = if IsWindowVisible(hwnd) != 0 {
            state.strings.menu_hide
        } else {
            state.strings.menu_show
        };
        AppendMenuW(menu, MF_STRING, ID_MENU_TOGGLE, wide(toggle_label).as_ptr());
        AppendMenuW(menu, MF_SEPARATOR, 0, null());
        AppendMenuW(menu, MF_STRING, ID_MENU_QUIT, wide(state.strings.menu_quit).as_ptr());

        let mut cursor = zeroed();
        GetCursorPos(&mut cursor);

        // Required so the menu closes when the user clicks elsewhere.
        SetForegroundWindow(hwnd);
        TrackPopupMenu(menu, TPM_RIGHTBUTTON, cursor.x, cursor.y, 0, hwnd, null());
        PostMessageW(hwnd, WM_NULL, 0, 0);
        DestroyMenu(menu);
    }
}

/// # Safety
/// `hwnd` must be the main window, inside its `WM_PAINT` handler.
unsafe fn paint(hwnd: HWND, state: &State) {
    // SAFETY: the usual BeginPaint/EndPaint sequence, with double buffering.
    unsafe {
        let mut ps: PAINTSTRUCT = zeroed();
        let hdc = BeginPaint(hwnd, &mut ps);

        let mut client: RECT = zeroed();
        windows_sys::Win32::UI::WindowsAndMessaging::GetClientRect(hwnd, &mut client);

        let buffer_dc = CreateCompatibleDC(hdc);
        let bitmap = CreateCompatibleBitmap(hdc, client.right, client.bottom);
        let previous = SelectObject(buffer_dc, bitmap as HGDIOBJ);

        FillRect(buffer_dc, &client, GetSysColorBrush(COLOR_WINDOW));
        SetBkMode(buffer_dc, TRANSPARENT as i32);

        let text_color = GetSysColor(COLOR_WINDOWTEXT);
        let muted_color = GetSysColor(COLOR_GRAYTEXT);
        let single_line = DT_LEFT | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS;

        draw_text(
            buffer_dc,
            state.font_caption,
            muted_color,
            &utf16("DISCORD QUEST COMPLETER"),
            state.caption_rect(),
            single_line,
        );
        draw_text(
            buffer_dc,
            state.font_title,
            text_color,
            &utf16(&state.title),
            state.title_rect(),
            DT_LEFT | DT_WORDBREAK | DT_NOPREFIX | DT_END_ELLIPSIS,
        );
        draw_text(
            buffer_dc,
            state.font_body,
            muted_color,
            &utf16(state.strings.subtitle),
            state.subtitle_rect(),
            DT_LEFT | DT_WORDBREAK | DT_NOPREFIX,
        );
        draw_text(
            buffer_dc,
            state.font_body,
            text_color,
            &utf16(&state.uptime_text()),
            state.uptime_rect(),
            single_line,
        );

        BitBlt(hdc, 0, 0, client.right, client.bottom, buffer_dc, 0, 0, SRCCOPY);

        SelectObject(buffer_dc, previous);
        DeleteObject(bitmap as HGDIOBJ);
        DeleteDC(buffer_dc);
        EndPaint(hwnd, &ps);
    }
}

/// # Safety
/// `hwnd` must be the main window, inside its `WM_CREATE` handler.
unsafe fn on_create(hwnd: HWND, state: &mut State) {
    // SAFETY: creates GDI resources and child windows owned by `hwnd`.
    unsafe {
        let face = wide("Segoe UI");
        state.font_caption = create_font(state.scale(11), FW_BOLD, &face);
        state.font_title = create_font(state.scale(24), FW_BOLD, &face);
        state.font_body = create_font(state.scale(14), FW_NORMAL, &face);

        let module = GetModuleHandleW(null());
        let button_top = state.scale(184);
        let button_height = state.scale(32);
        let button_width = state.scale((CLIENT_WIDTH - MARGIN * 2 - 12) / 2);

        let buttons = [
            (state.strings.hide_button, ID_BUTTON_HIDE, state.scale(MARGIN)),
            (
                state.strings.quit_button,
                ID_BUTTON_QUIT,
                state.scale(MARGIN) + button_width + state.scale(12),
            ),
        ];
        for (label, id, left) in buttons {
            let button = CreateWindowExW(
                0,
                wide("BUTTON").as_ptr(),
                wide(label).as_ptr(),
                WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON as u32,
                left,
                button_top,
                button_width,
                button_height,
                hwnd,
                id as _,
                module,
                null(),
            );
            SendMessageW(button, WM_SETFONT, state.font_body as WPARAM, 1);
        }

        add_tray_icon(hwnd, state);
        SetTimer(hwnd, TIMER_UPTIME, 1000, None);
    }
}

/// # Safety
/// `hwnd` must be the main window, inside its `WM_DESTROY` handler.
unsafe fn on_destroy(hwnd: HWND, state: &State) {
    // SAFETY: releases the resources created in `on_create`.
    unsafe {
        KillTimer(hwnd, TIMER_UPTIME);
        remove_tray_icon(hwnd, state);
        for font in [state.font_caption, state.font_title, state.font_body] {
            DeleteObject(font as HGDIOBJ);
        }
        PostQuitMessage(0);
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // SAFETY: Windows calls this procedure with parameters consistent with `message`.
    unsafe {
        if message == WM_NCCREATE {
            let create = lparam as *const CREATESTRUCTW;
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, (*create).lpCreateParams as isize);
            return DefWindowProcW(hwnd, message, wparam, lparam);
        }

        let state_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut State;
        if state_ptr.is_null() {
            return DefWindowProcW(hwnd, message, wparam, lparam);
        }

        if message == WM_NCDESTROY {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            drop(Box::from_raw(state_ptr));
            return DefWindowProcW(hwnd, message, wparam, lparam);
        }

        let state = &mut *state_ptr;

        // Explorer restarted: the tray icon has to be created again.
        if message == state.taskbar_created {
            add_tray_icon(hwnd, state);
            return 0;
        }

        match message {
            WM_CREATE => {
                on_create(hwnd, state);
                0
            }
            WM_ERASEBKGND => 1,
            WM_PAINT => {
                paint(hwnd, state);
                0
            }
            WM_TIMER if wparam == TIMER_UPTIME => {
                let rect = state.uptime_rect();
                InvalidateRect(hwnd, &rect, 0);
                0
            }
            WM_COMMAND => {
                match wparam & 0xFFFF {
                    ID_BUTTON_HIDE => {
                        ShowWindow(hwnd, SW_HIDE);
                    }
                    ID_BUTTON_QUIT | ID_MENU_QUIT => {
                        DestroyWindow(hwnd);
                    }
                    ID_MENU_TOGGLE => toggle_window(hwnd),
                    _ => {}
                }
                0
            }
            WM_TRAY => {
                match (lparam & 0xFFFF) as u32 {
                    WM_LBUTTONUP => toggle_window(hwnd),
                    WM_RBUTTONUP | WM_CONTEXTMENU => show_tray_menu(hwnd, state),
                    _ => {}
                }
                0
            }
            WM_DESTROY => {
                on_destroy(hwnd, state);
                0
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }
}

pub fn run(options: &Options) {
    // SAFETY: the whole window lifecycle happens on this thread.
    unsafe {
        let module = GetModuleHandleW(null());
        let class_name = wide("DQCRunnerWindow");
        let icon = load_app_icon();

        let class = WNDCLASSEXW {
            cbSize: size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(window_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: module,
            hIcon: icon,
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            hbrBackground: null_mut(),
            lpszMenuName: null(),
            lpszClassName: class_name.as_ptr(),
            hIconSm: icon,
        };
        if RegisterClassExW(&class) == 0 {
            return;
        }

        let dpi = GetDpiForSystem().max(96);
        let state = Box::new(State {
            title: options.title.clone(),
            strings: Strings::for_lang(options.lang),
            started_at_ms: GetTickCount64(),
            dpi,
            font_caption: null_mut(),
            font_title: null_mut(),
            font_body: null_mut(),
            taskbar_created: RegisterWindowMessageW(wide("TaskbarCreated").as_ptr()),
        });

        let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_CLIPCHILDREN;
        let mut frame = RECT {
            left: 0,
            top: 0,
            right: state.scale(CLIENT_WIDTH),
            bottom: state.scale(CLIENT_HEIGHT),
        };
        AdjustWindowRectEx(&mut frame, style, 0, 0);

        // Ownership of the state moves to the window (freed in WM_NCDESTROY).
        let state_ptr = Box::into_raw(state);
        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            wide(&options.title).as_ptr(),
            style,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            frame.right - frame.left,
            frame.bottom - frame.top,
            null_mut(),
            null_mut(),
            module,
            state_ptr as *const c_void,
        );
        if hwnd.is_null() {
            return;
        }

        // Never take the focus: the user is probably in the middle of something else.
        match options.window {
            WindowMode::Normal => {
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                UpdateWindow(hwnd);
            }
            WindowMode::Minimized => {
                ShowWindow(hwnd, SW_SHOWMINNOACTIVE);
            }
            WindowMode::Hidden => {}
        }

        let mut message: MSG = zeroed();
        while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
            if IsDialogMessageW(hwnd, &message) == 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }
}
