//
//  EchoFileOpener.swift
//  Echo
//
//  Системный предпросмотр файлов на iOS (QuickLook), аналог Telegram:
//  файл из приватного кэша приложения показывается модально ПОВЕРХ
//  приложения, без запуска стороннего приложения.
//
//  Зачем не UIApplication.open / UIDocumentInteractionController:
//    • `UIApplication.open(file://…)` не отдаёт чужому приложению файл из
//      нашего контейнера (песочница) — ссылка просто не открывается;
//    • `UIDocumentInteractionController` требует копию документа в
//      Documents/Inbox и умеет только «Открыть в…».
//  QLPreviewController читает файл прямо из песочницы и даёт системный
//  просмотрщик с кнопкой «Поделиться».
//
//  Вызывается из Rust (src-tauri/src/file_open.rs) через C-ABI:
//      echo_open_file_ios(path) → 0 ok | 1 файла нет | 2 не удалось показать
//  Функция вызывается на main thread (Rust использует run_on_main_thread),
//  но подстрахована синхронным переносом в main, если поток окажется другим.
//

import Foundation
import QuickLook
import UIKit

/// Коды ответа C-моста (см. ios::open_file_ios в file_open.rs).
private enum EchoFileOpenResult: Int32 {
    case ok = 0
    case fileNotFound = 1
    case presentationFailed = 2
}

/// Один элемент предпросмотра: путь к файлу + отображаемое имя.
private final class EchoPreviewItem: NSObject, QLPreviewItem {
    let previewItemURL: URL
    let previewItemTitle: String?

    init(url: URL, title: String?) {
        self.previewItemURL = url
        self.previewItemTitle = title
    }
}

/// Датасорс держит элемент сильно: QLPreviewController хранит dataSource
/// слабо, поэтому владелец — презентер, а не контроллер.
private final class EchoPreviewDataSource: NSObject, QLPreviewControllerDataSource {
    private let item: QLPreviewItem

    init(item: QLPreviewItem) {
        self.item = item
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

    func previewController(_ controller: QLPreviewController,
                           previewItemAt index: Int) -> QLPreviewItem { item }
}

/// Презентер QuickLook: создаёт контроллер, показывает поверх активного
/// экрана и живёт до закрытия предпросмотра.
private final class EchoPreviewPresenter: NSObject, QLPreviewControllerDelegate {
    static let shared = EchoPreviewPresenter()

    /// Сильные ссылки: без них QLPreviewController теряет датасорс/элемент.
    private var dataSource: EchoPreviewDataSource?
    private weak var controller: QLPreviewController?

    /// Показать файл по абсолютному пути в контейнере приложения.
    func present(path: String) -> EchoFileOpenResult {
        let url = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: url.path) else {
            NSLog("[OPEN-MOBILE] ios: файла нет по пути %@", url.path)
            return .fileNotFound
        }
        guard let host = EchoPreviewPresenter.topViewController() else {
            NSLog("[OPEN-MOBILE] ios: не найден host-контроллер для QuickLook")
            return .presentationFailed
        }

        // Повторный тап по другому файлу: закрываем предыдущий предпросмотр,
        // чтобы не копить стеки модалок.
        if let live = controller, live.presentingViewController != nil {
            live.dismiss(animated: false)
        }

        let source = EchoPreviewDataSource(
            item: EchoPreviewItem(url: url, title: url.lastPathComponent)
        )
        let preview = QLPreviewController()
        preview.dataSource = source
        preview.delegate = self
        // .fullScreen — одинаково предсказуемо на iPhone и iPad (у QuickLook
        // своя кнопка «Готово», которая закрывает модалку).
        preview.modalPresentationStyle = .fullScreen

        dataSource = source
        controller = preview
        host.present(preview, animated: true, completion: nil)
        NSLog("[OPEN-MOBILE] ios: QuickLook показан для %@", url.lastPathComponent)
        return .ok
    }

    /// Предпросмотр закрыт — снимаем ссылки, чтобы не держать контроллер
    /// (и открытый файл) живым до следующего тапа.
    func previewControllerDidDismiss(_ controller: QLPreviewController) {
        dataSource = nil
        self.controller = nil
    }

    /// Верхний контроллер активного окна: presented-цепочка + контейнеры
    /// (навигация/табы), чтобы модалка легла поверх того, что видит юзер.
    private static func topViewController(from base: UIViewController? = nil) -> UIViewController? {
        if let base = base {
            if let presented = base.presentedViewController {
                return topViewController(from: presented)
            }
            if let nav = base as? UINavigationController {
                return topViewController(from: nav.visibleViewController)
            }
            if let tab = base as? UITabBarController {
                return topViewController(from: tab.selectedViewController)
            }
            return base
        }

        let scenes = UIApplication.shared.connectedScenes
        let windowScene = (scenes.first { $0.activationState == .foregroundActive }
            as? UIWindowScene) ?? (scenes.first as? UIWindowScene)
        guard let window = windowScene?.windows.first(where: { $0.isKeyWindow })
            ?? windowScene?.windows.first else {
            return nil
        }
        return topViewController(from: window.rootViewController)
    }
}

/// C-точка входа для Rust (extern "C" в file_open.rs).
@_cdecl("echo_open_file_ios")
public func echo_open_file_ios(_ path: UnsafePointer<CChar>?) -> Int32 {
    guard let path = path else { return EchoFileOpenResult.fileNotFound.rawValue }
    let filePath = String(cString: path)

    // UIKit — только main thread.
    if Thread.isMainThread {
        return EchoPreviewPresenter.shared.present(path: filePath).rawValue
    }
    var code = EchoFileOpenResult.presentationFailed.rawValue
    DispatchQueue.main.sync {
        code = EchoPreviewPresenter.shared.present(path: filePath).rawValue
    }
    return code
}

