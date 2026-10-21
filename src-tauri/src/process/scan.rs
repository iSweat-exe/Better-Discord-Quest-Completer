//! Lists the executables currently running on the machine.

/// Lower-cased file names (`discord.exe`) of every running process.
#[cfg(windows)]
pub fn running_executables() -> Vec<String> {
    use std::mem::size_of;

    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
    };

    let mut names = Vec::new();

    // SAFETY: a process snapshot is a plain kernel handle, closed below.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return names;
    }

    // SAFETY: PROCESSENTRY32W is plain data for which zero is a valid value.
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = u32::try_from(size_of::<PROCESSENTRY32W>()).unwrap_or(0);

    // SAFETY: `snapshot` is valid and `entry.dwSize` is initialized, as the API requires.
    let mut more = unsafe { Process32FirstW(snapshot, &raw mut entry) } != 0;
    while more {
        let length = entry.szExeFile.iter().position(|&unit| unit == 0).unwrap_or(entry.szExeFile.len());
        names.push(String::from_utf16_lossy(&entry.szExeFile[..length]).to_lowercase());

        // SAFETY: same invariants as for `Process32FirstW`.
        more = unsafe { Process32NextW(snapshot, &raw mut entry) } != 0;
    }

    // SAFETY: the handle came from `CreateToolhelp32Snapshot` and is closed exactly once.
    unsafe { CloseHandle(snapshot) };
    names
}

/// Process listing is only implemented for Windows.
#[cfg(not(windows))]
pub fn running_executables() -> Vec<String> {
    Vec::new()
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn lists_the_current_process() {
        let current = std::env::current_exe().unwrap();
        let name = current.file_name().unwrap().to_string_lossy().to_lowercase();
        assert!(running_executables().contains(&name));
    }

    #[test]
    fn names_are_lower_case() {
        assert!(running_executables().iter().all(|name| *name == name.to_lowercase()));
    }
}
