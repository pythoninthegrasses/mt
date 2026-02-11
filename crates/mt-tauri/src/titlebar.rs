/// Linux GTK HeaderBar for native CSD titlebar.
///
/// Replaces the standard window manager titlebar with a GTK HeaderBar
/// whose background color adapts to the active frontend theme.
///
/// GTK objects are `!Sync`, so the [`CssProvider`] lives in a main-thread
/// `thread_local`. The Tauri command [`set_titlebar_color`] bounces updates
/// back to the main thread via `glib::idle_add_once`.
#[cfg(target_os = "linux")]
use std::cell::RefCell;

#[cfg(target_os = "linux")]
use gtk::prelude::*;

#[cfg(target_os = "linux")]
thread_local! {
    static CSS_PROVIDER: RefCell<Option<gtk::CssProvider>> = const { RefCell::new(None) };
}

/// Create a GTK HeaderBar and set it as the window's titlebar.
///
/// Must be called during `setup()` before the window is shown.
#[cfg(target_os = "linux")]
pub fn setup_headerbar(window: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let gtk_window = window.gtk_window()?;

    let header_bar = gtk::HeaderBar::new();
    header_bar.set_show_close_button(true);
    header_bar.set_title(None::<&str>);
    header_bar.set_has_subtitle(false);

    // Apply an initial transparent style so basecoat bg-background shows through
    let provider = gtk::CssProvider::new();
    provider
        .load_from_data(
            b"headerbar {
                background: transparent;
                border: none;
                box-shadow: none;
                min-height: 28px;
                padding: 0 6px;
            }",
        )
        .ok();

    // Disambiguate: GtkWindowExt::screen (not WidgetExt::screen)
    let screen = gtk::prelude::GtkWindowExt::screen(&gtk_window)
        .expect("GTK window must have a screen");
    gtk::StyleContext::add_provider_for_screen(
        &screen,
        &provider,
        gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
    );

    // Store the provider in a main-thread thread_local for later updates
    CSS_PROVIDER.with(|cell| {
        *cell.borrow_mut() = Some(provider);
    });

    gtk_window.set_titlebar(Some(&header_bar));
    println!("GTK HeaderBar set as CSD titlebar");

    Ok(())
}

/// Update the HeaderBar background color from the frontend theme.
///
/// The frontend calls this whenever the theme changes, passing the
/// computed CSS `bg-background` color (e.g. `"rgb(30, 30, 30)"` or `"rgb(255, 255, 255)"`).
///
/// Because Tauri commands run on a Tokio thread, this dispatches the GTK
/// update back to the main thread via `glib::idle_add_once`.
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn set_titlebar_color(color: String) -> Result<(), String> {
    gtk::glib::idle_add_once(move || {
        CSS_PROVIDER.with(|cell| {
            if let Some(provider) = cell.borrow().as_ref() {
                let css = format!(
                    "headerbar {{
                        background: {color};
                        border: none;
                        box-shadow: none;
                        min-height: 28px;
                        padding: 0 6px;
                    }}"
                );
                provider.load_from_data(css.as_bytes()).ok();
            }
        });
    });
    Ok(())
}

/// No-op on non-Linux platforms.
#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn set_titlebar_color(_color: String) -> Result<(), String> {
    Ok(())
}
