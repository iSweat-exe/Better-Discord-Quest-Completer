//! A Windows job object that kills every fake game when the app goes away.
//!
//! Without it, a crash of the manager would leave orphan processes running
//! (and keep Discord believing a game is still being played).

#[cfg(windows)]
pub use windows_impl::ProcessJob;

#[cfg(not(windows))]
pub use fallback::ProcessJob;

#[cfg(not(windows))]
mod fallback {
    use std::io;
    use std::process::Child;

    /// No-op on platforms without job objects.
    pub struct ProcessJob;

    impl ProcessJob {
        #[expect(clippy::unnecessary_wraps, reason = "mirrors the fallible Windows API")]
        pub fn new() -> io::Result<Self> {
            Ok(Self)
        }

        #[expect(clippy::unused_self, clippy::unnecessary_wraps, reason = "mirrors the Windows API")]
        pub fn assign(&self, _child: &Child) -> io::Result<()> {
            Ok(())
        }
    }
}

#[cfg(windows)]
mod windows_impl {
    use std::ffi::c_void;
    use std::io;
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use std::ptr::{null, null_mut};

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };

    /// Size of the limits structure, checked at compile time to fit a `u32`.
    const LIMITS_SIZE: u32 = {
        let size = size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
        assert!(size <= u32::MAX as usize);
        #[expect(clippy::cast_possible_truncation, reason = "bounded by the assertion above")]
        {
            size as u32
        }
    };

    pub struct ProcessJob(HANDLE);

    // SAFETY: a job object handle is just a kernel object reference; the Win32
    // API allows using it from any thread.
    unsafe impl Send for ProcessJob {}
    unsafe impl Sync for ProcessJob {}

    impl ProcessJob {
        pub fn new() -> io::Result<Self> {
            // SAFETY: both arguments are optional and may be null; the returned
            // handle is owned by `ProcessJob` and closed in `Drop`.
            let handle = unsafe { CreateJobObjectW(null(), null()) };
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            let job = Self(handle);

            // SAFETY: the structure is plain data, for which zero is valid.
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            // SAFETY: `limits` outlives the call and its size is passed along.
            let configured = unsafe {
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    (&raw const limits).cast::<c_void>(),
                    LIMITS_SIZE,
                )
            };
            if configured == 0 {
                return Err(io::Error::last_os_error());
            }

            Ok(job)
        }

        pub fn assign(&self, child: &Child) -> io::Result<()> {
            // SAFETY: both handles are valid for the duration of the call.
            let assigned = unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle()) };
            if assigned == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
        }
    }

    impl Drop for ProcessJob {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: the handle is owned by `self` and closed exactly once.
                unsafe { CloseHandle(std::mem::replace(&mut self.0, null_mut())) };
            }
        }
    }
}
