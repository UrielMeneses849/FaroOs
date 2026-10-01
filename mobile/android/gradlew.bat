@ECHO OFF
SET APP_HOME=%~dp0
java %JAVA_OPTS% -jar "%APP_HOME%\gradle\wrapper\gradle-wrapper.jar" %*
