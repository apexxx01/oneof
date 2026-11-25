// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "OneOfCore",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [.library(name: "OneOfCore", targets: ["OneOfCore"])],
  targets: [
    .target(name: "OneOfCore"),
    .testTarget(name: "OneOfCoreTests", dependencies: ["OneOfCore"], exclude: ["Resources"]),
  ]
)
