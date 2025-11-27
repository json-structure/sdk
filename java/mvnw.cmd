@REM ----------------------------------------------------------------------------
@REM Licensed to the Apache Software Foundation (ASF) under one
@REM or more contributor license agreements.  See the NOTICE file
@REM distributed with this work for additional information
@REM regarding copyright ownership.  The ASF licenses this file
@REM to you under the Apache License, Version 2.0 (the
@REM "License"); you may not use this file except in compliance
@REM with the License.  You may obtain a copy of the License at
@REM
@REM    https://www.apache.org/licenses/LICENSE-2.0
@REM
@REM Unless required by applicable law or agreed to in writing,
@REM software distributed under the License is distributed on an
@REM "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
@REM KIND, either express or implied.  See the License for the
@REM specific language governing permissions and limitations
@REM under the License.
@REM ----------------------------------------------------------------------------

@REM Maven Wrapper script for Windows

@echo off
setlocal

set MAVEN_PROJECTBASEDIR=%~dp0

@REM Find java.exe
if defined JAVA_HOME goto findJavaFromJavaHome

set JAVA_EXE=java.exe
%JAVA_EXE% -version >NUL 2>&1
if %ERRORLEVEL% equ 0 goto checkMavenWrapperJar

echo Error: JAVA_HOME is not set and no 'java' command could be found in your PATH.
goto error

:findJavaFromJavaHome
set JAVA_EXE=%JAVA_HOME%\bin\java.exe

if exist "%JAVA_EXE%" goto checkMavenWrapperJar

echo Error: JAVA_HOME is set to an invalid directory: %JAVA_HOME%
goto error

:checkMavenWrapperJar
set WRAPPER_JAR="%MAVEN_PROJECTBASEDIR%.mvn\wrapper\maven-wrapper.jar"
set WRAPPER_PROPERTIES="%MAVEN_PROJECTBASEDIR%.mvn\wrapper\maven-wrapper.properties"

if exist %WRAPPER_JAR% goto runWrapper

@REM Download wrapper jar if it doesn't exist
if not exist %WRAPPER_PROPERTIES% (
    echo Error: %WRAPPER_PROPERTIES% not found.
    goto error
)

for /f "tokens=2 delims==" %%a in ('findstr /r "^wrapperUrl=" %WRAPPER_PROPERTIES%') do set WRAPPER_URL=%%a

echo Downloading Maven Wrapper...

@REM Use PowerShell to download
powershell -Command "& { $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '%WRAPPER_URL%' -OutFile %WRAPPER_JAR% }"

if %ERRORLEVEL% neq 0 (
    echo Error: Failed to download Maven Wrapper.
    goto error
)

:runWrapper
"%JAVA_EXE%" ^
  %MAVEN_OPTS% ^
  -classpath %WRAPPER_JAR% ^
  org.apache.maven.wrapper.MavenWrapperMain %*

if %ERRORLEVEL% neq 0 goto error
goto end

:error
set ERRORLEVEL=1

:end
endlocal
