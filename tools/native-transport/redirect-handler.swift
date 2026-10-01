// URLSession behavior that the nitro-fetch redirect patch depends on.
// Run through redirect-handler.mjs, which serves the 307 on localhost.
//
// The delegate receives a redirect after its task was cancelled, the order
// in which JS cancel() can beat a redirect already on its way to the delegate.
// "held" stores the completion handler and never calls it; "refused" calls it
// with nil at once. Each line reports whether the task completed and whether
// the delegate was released after the session was invalidated.
import Foundation

final class Delegate: NSObject, URLSessionDataDelegate {
  let hold: Bool
  var held: ((URLRequest?) -> Void)?
  var code = 0
  let completed = DispatchSemaphore(value: 0)

  init(hold: Bool) { self.hold = hold }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    task.cancel()
    if hold { held = completionHandler } else { completionHandler(nil) }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    code = (error as NSError?)?.code ?? 0
    session.finishTasksAndInvalidate()
    completed.signal()
  }
}

func run(hold: Bool, url: URL) -> String {
  weak var probe: Delegate?
  var code: Int?
  autoreleasepool {
    let delegate = Delegate(hold: hold)
    probe = delegate
    URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
      .dataTask(with: url).resume()
    if delegate.completed.wait(timeout: .now() + 5) == .success { code = delegate.code }
  }
  let deadline = Date() + 2
  while probe != nil && Date() < deadline {
    autoreleasepool { _ = RunLoop.main.run(mode: .default, before: Date() + 0.05) }
  }
  let completed = code.map(String.init) ?? "null"
  return "{\"mode\":\"\(hold ? "held" : "refused")\",\"completed\":\(completed),\"released\":\(probe == nil)}"
}

let url = URL(string: "http://127.0.0.1:\(CommandLine.arguments[1])/redirect")!
print(run(hold: true, url: url))
print(run(hold: false, url: url))
