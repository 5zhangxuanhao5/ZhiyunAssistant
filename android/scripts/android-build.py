#!/usr/bin/env python3
"""Build and sign APKs. Local secrets are never stored in the project or command-line args."""
import argparse, hashlib, json, os, pathlib, subprocess, re

project = pathlib.Path(__file__).resolve().parent.parent
version = re.search(r"versionName\s+'([^']+)'", (project/'app/build.gradle').read_text()).group(1)
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{1,63}', version): raise ValueError('Invalid version name')
parser = argparse.ArgumentParser()
parser.add_argument('--debug', action='store_true')
parser.add_argument('--unsigned', action='store_true')
parser.add_argument('--instrumentation', action='store_true', help='Build a separately signed, same-key native test APK; never publish this artifact.')
args = parser.parse_args()
tools = pathlib.Path(os.environ.get('ZHIYUN_ANDROID_TOOLS', str(pathlib.Path.home() / 'Library/Android/zhiyun-tools')))
sdk = pathlib.Path(os.environ.get('ANDROID_HOME', str(tools / 'sdk')))
java = os.environ.get('JAVA_HOME') or str(next((tools/'jdk17').glob('*/Contents/Home')))
env = dict(os.environ, JAVA_HOME=java, ANDROID_HOME=str(sdk), ANDROID_SDK_ROOT=str(sdk))
gradle = tools/'gradle-8.13/bin/gradle'
if not gradle.exists(): gradle = project/'gradlew'
kind = 'debug' if args.debug or args.instrumentation else 'release'
task = ':app:assembleDebugAndroidTest' if args.instrumentation else ':app:assemble' + kind.capitalize()
subprocess.run([str(gradle), task, '--no-daemon'], cwd=project, env=env, check=True)
apk = project/'app/build/outputs/apk'/kind/('app-debug.apk' if args.debug else 'app-release-unsigned.apk')
if args.instrumentation: apk = project/'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
if args.unsigned:
    print(apk)
    raise SystemExit(0)
config = pathlib.Path(os.environ.get('ZHIYUN_ANDROID_SIGNING', str(pathlib.Path.home()/'.codex/android-signing/cn.suike.slides.android.credentials.json')))
secret = json.loads(config.read_text())
env['ZHIYUN_KEYSTORE_PASSWORD'] = secret['password']
destination = project/'dist'
destination.mkdir(exist_ok=True)
output = destination/('ZhiyunAssistant-' + version + '-Android' + ('-tests' if args.instrumentation else '-debug' if args.debug else '') + '.apk')
unsigned = destination/('temporary-' + kind + '.apk')
buildtools = sdk/'build-tools/36.0.0'
subprocess.run([str(buildtools/'zipalign'), '-f','-p','4',str(apk),str(unsigned)], check=True, env=env)
subprocess.run([str(buildtools/'apksigner'),'sign','--ks',secret['keystore'],'--ks-key-alias',secret['alias'],
                '--ks-pass','env:ZHIYUN_KEYSTORE_PASSWORD','--key-pass','env:ZHIYUN_KEYSTORE_PASSWORD',
                '--out',str(output),str(unsigned)], check=True, env=env)
unsigned.unlink()
subprocess.run([str(buildtools/'apksigner'),'verify','--verbose','--print-certs',str(output)], check=True, env=env)
print('APK: '+str(output))
print('SHA256: '+hashlib.sha256(output.read_bytes()).hexdigest())
